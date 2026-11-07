import { createHash } from 'node:crypto';
import { Branch, Counter, GstItcDecision, GstReturn, GstTaxEntry, GstWorksheet } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { gstSetupActive } from './gst.billing.js';
import { saveProof } from './gst.proofs.js';
import { canWork, mayView, mayWork, myGstins } from './gstr1.service.js';
import { purchaseGrid } from './gst.purchases.js';
import { WORKSHEET_MAPPING, buildWorksheetRows, worksheetDifferences, worksheetSummary } from './gst.purchases.rules.js';

// ---------------------------------------------------------------------------
// The GSTR-3B working sheet: output tax from the tax record and approved credit from purchases, in the rows of the form.
// Our figures and the portal's are kept apart. It never says the tax was paid, and it has no interest, late fees or
// ledger balances: the owner pays and files on the portal, then records the ARN and proof here.
// ---------------------------------------------------------------------------

async function loadSheet(ctx, id, session = null) {
  const sheet = await GstWorksheet.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!sheet) throw new AppError(404, 'NOT_FOUND', 'Working sheet not found');
  const { mine } = await myGstins(ctx, session);
  if (!mine.some((r) => r.gstin === sheet.gstin)) throw new AppError(404, 'NOT_FOUND', 'Working sheet not found');
  return sheet;
}

// What decides a month's sheet: its tax record, as GSTR-1 reads it (a voided bill and its void are left out), and the decisions that stand
async function sourceOf(ctx, gstin, period, session = null) {
  const all = await GstTaxEntry.find(scoped(ctx, { gstin, period })).sort({ taxDate: 1, _id: 1 }).session(session).lean();
  const voids = await GstTaxEntry.find(scoped(ctx, { type: 'BILL_VOIDED', invoiceId: { $in: all.filter((e) => e.type === 'BILL_ISSUED').map((e) => e.invoiceId) } })).select('invoiceId sourceKey').session(session).lean();
  const voided = new Set(voids.map((v) => String(v.invoiceId)));
  const entries = all.filter((e) => e.type !== 'BILL_VOIDED' && !(e.type === 'BILL_ISSUED' && voided.has(String(e.invoiceId))));
  const { rows, imported } = await purchaseGrid(ctx, gstin, period, session);
  const standing = rows.map((r) => r.decision).filter(Boolean);
  const hash = createHash('sha256').update([...all.map((e) => e.sourceKey), ...voids.map((v) => v.sourceKey), ...rows.map((r) => `${r.key}:${r.status}:${r.decision?._id ?? ''}`), imported?.fileHash ?? ''].sort().join('\n')).digest('hex');
  return { entries, rows, imported, standing, hash };
}

// What stops this sheet being approved, and what to check. Unresolved rows don't stop anyone looking at a draft.
function notesFor({ rows, imported }, filedReturn, period) {
  const notes = [];
  const link = `/app/gst?tab=purchases&month=${period}`;
  const open = rows.filter((r) => !r.resolved);
  if (rows.some((r) => r.bill) && !imported) notes.push({ severity: 'BLOCKER', code: 'NO_VALID_2B_IMPORT', message: 'Import GSTR-2B for this month, so your purchases can be checked.', link });
  if (open.length > 0) notes.push({ severity: 'BLOCKER', code: 'ITC_POLICY_UNRESOLVED', message: `${open.length} purchase${open.length === 1 ? '' : 's'} still need${open.length === 1 ? 's' : ''} a decision.`, link });
  if (!rows.length && !imported) notes.push({ severity: 'WARNING', code: 'NO_PURCHASES', message: 'No purchases or GSTR-2B for this month, so no credit is shown.', link });
  if (!filedReturn) notes.push({ severity: 'WARNING', code: 'GSTR1_NOT_FILED', message: 'GSTR-1 for this month isn’t recorded as filed yet. The portal’s GSTR-3B figures come from it.', link: '/app/gst?tab=returns' });
  return notes;
}

// Makes a new revision from the records as they are now. Earlier revisions stay.
export async function prepareWorksheet(ctx, { gstin, period }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  if (!gstSetupActive(settings)) throw new AppError(409, 'GST_NOT_ACTIVE', 'Activate GST setup first');
  if (period < settings.gst.startMonth) throw new AppError(400, 'BEFORE_START_MONTH', `Your tax record begins in ${settings.gst.startMonth}`);

  return runOnce(ctx, { key, operation: 'gst.worksheet.prepare' }, async (session) => {
    const { mine } = await myGstins(ctx, session);
    const registration = mine.find((r) => r.gstin === gstin);
    if (!registration) throw new AppError(404, 'NOT_FOUND', 'GSTIN not found');
    if (await GstWorksheet.exists(scoped(ctx, { gstin, period, status: 'FILED' })).session(session)) throw new AppError(409, 'FILED_PERIOD_LOCKED', 'GSTR-3B for this month has been filed, so its sheet can’t change.');
    const source = await sourceOf(ctx, gstin, period, session);
    const filedReturn = await GstReturn.exists(scoped(ctx, { gstin, period, status: 'FILED' })).session(session);
    const rows = buildWorksheetRows(source.entries, source.standing);
    const previous = await GstWorksheet.findOne(scoped(ctx, { gstin, period, superseded: false })).select('portal').session(session).lean();
    const counter = await Counter.findOneAndUpdate({ _id: `gstworksheet:${ctx.orgId}:${gstin}:${period}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    await GstWorksheet.updateMany(scoped(ctx, { gstin, period, superseded: false }), { $set: { superseded: true } }, { session });
    const [created] = await GstWorksheet.create(
      [{ orgId: ctx.orgId, gstin, legalName: registration.legalName, period, revision: counter.seq, status: 'DRAFT', cutoffAt: new Date(), mapping: WORKSHEET_MAPPING, rows, summary: worksheetSummary(rows), notes: notesFor(source, filedReturn, period), sourceHash: source.hash, portal: previous?.portal, preparedByName: ctx.userName }],
      { session }
    );
    await logActivity(ctx, { action: 'billing.gst_worksheet_prepared', summary: `Prepared the GSTR-3B working sheet for ${gstin}, ${period}, revision ${counter.seq}`, after: { worksheetId: created._id } }, session);
    return { worksheetId: created._id, revision: counter.seq };
  });
}

export async function getWorksheet(ctx, id) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const sheet = await loadSheet(ctx, id);
  const source = await sourceOf(ctx, sheet.gstin, sheet.period);
  const revisions = await GstWorksheet.find(scoped(ctx, { gstin: sheet.gstin, period: sheet.period })).select('revision status createdAt preparedByName').sort({ revision: -1 }).lean();
  const strip = ({ entryIds, decisionIds, ...row }) => ({ ...row, count: (entryIds ?? decisionIds ?? []).length });
  const filedReturn = await GstReturn.exists(scoped(ctx, { gstin: sheet.gstin, period: sheet.period, status: 'FILED' }));
  return {
    ...sheet,
    notes: sheet.notes.filter((n) => !(n.code === 'GSTR1_NOT_FILED' && filedReturn)), // GSTR-1 may have been filed since this revision
    rows: sheet.rows.map(strip),
    differences: worksheetDifferences(sheet.rows, sheet.portal?.rows),
    outOfDate: source.hash !== sheet.sourceHash,
    revisions,
    canWork: canWork(ctx, settings),
  };
}

// What is behind one row: tax entries for sales, bills and decisions for credit. Every amount claimed traces to one bill and one decision.
export async function worksheetTrail(ctx, id, key) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const sheet = await loadSheet(ctx, id);
  const row = sheet.rows.find((r) => r.key === key);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'That row was not found');
  if (row.decisionIds) {
    const decisions = await GstItcDecision.find(scoped(ctx, { _id: { $in: row.decisionIds } })).lean();
    return { key, decisions: decisions.map((d) => ({ _id: d._id, documentNumber: d.documentNumber, supplierName: d.supplierName, eligible: d.eligible, notEligible: d.notEligible, reason: d.reason, decidedByName: d.decidedByName, at: d.createdAt, billId: d.billId })) };
  }
  const filter = ctx.isPrimaryOwner ? {} : { branchId: { $in: ctx.allowedBranchIds } };
  const entries = await GstTaxEntry.find(scoped(ctx, { _id: { $in: row.entryIds ?? [] }, ...filter })).select('documentNumber type taxDate customerName taxable cgst sgst igst total invoiceId advanceId').sort({ taxDate: 1 }).lean();
  return { key, total: (row.entryIds ?? []).length, entries: entries.map((e) => ({ ...e, link: e.invoiceId ? `/app/invoices/${e.invoiceId}` : `/app/advances/${e.advanceId}` })) };
}

// The figures the portal shows, typed in as they are, per row. They sit beside ours, and never replace them.
export async function savePortalFigures(ctx, id, { rows }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadSheet(ctx, id);
  return runOnce(ctx, { key, operation: 'gst.worksheet.portal' }, async (session) => {
    if (first.status !== 'DRAFT' || first.superseded) throw new AppError(409, 'WORKSHEET_LOCKED', 'Portal figures can only be entered on the latest draft');
    const known = new Set(first.rows.map((r) => r.key));
    const unknown = Object.keys(rows).find((k) => !known.has(k));
    if (unknown) throw new AppError(400, 'VALIDATION_ERROR', `This sheet has no row ${unknown}`);
    await GstWorksheet.updateOne({ _id: first._id, status: 'DRAFT' }, { $set: { portal: { rows, enteredByName: ctx.userName, enteredAt: new Date() } } }, { session });
    await logActivity(ctx, { action: 'billing.gst_worksheet_portal', summary: `Entered the portal’s GSTR-3B figures for ${first.gstin}, ${first.period}`, after: { worksheetId: first._id } }, session);
    return { saved: true };
  });
}

// The owner approves the sheet. Unresolved purchases block it; differences with the portal need a note saying why.
export async function approveWorksheet(ctx, id, { differenceNote }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadSheet(ctx, id);
  return runOnce(ctx, { key, operation: 'gst.worksheet.approve' }, async (session) => {
    const sheet = await loadSheet(ctx, first._id, session);
    if (sheet.superseded) throw new AppError(409, 'RETURN_SUPERSEDED', 'A newer revision of this sheet exists. Open that one.');
    if (sheet.status !== 'DRAFT') throw new AppError(409, 'ALREADY_APPROVED', 'This sheet has already been approved');
    const source = await sourceOf(ctx, sheet.gstin, sheet.period, session);
    if (source.hash !== sheet.sourceHash) throw new AppError(409, 'RETURN_OUT_OF_DATE', 'The tax record or purchases have changed. Rebuild to make a new revision.');
    const blocker = sheet.notes.find((n) => n.severity === 'BLOCKER');
    if (blocker) throw new AppError(409, blocker.code, blocker.message);
    const differences = worksheetDifferences(sheet.rows, sheet.portal?.rows);
    if (differences.length > 0 && !differenceNote?.trim()) throw new AppError(400, 'DIFFERENCE_NOTE_REQUIRED', 'This sheet differs from the portal. Say why you are approving it, or fix the source first.');
    await GstWorksheet.updateOne({ _id: sheet._id, status: 'DRAFT' }, { $set: { status: 'APPROVED', approvedByName: ctx.userName, approvedAt: new Date(), differenceNote: differenceNote?.trim() || undefined } }, { session });
    await logActivity(ctx, { action: 'billing.gst_worksheet_approved', summary: `Approved the GSTR-3B working sheet for ${sheet.gstin}, ${sheet.period}, revision ${sheet.revision}${differences.length ? ` with ${differences.length} difference(s): ${differenceNote.trim()}` : ''}`, after: { worksheetId: sheet._id } }, session);
    return { approved: true };
  });
}

// Filing and paying happen on the portal. This records the filing, by hand, with the ARN and proof. It locks the month's
// purchases and credit, and closes GSTR-1A. It says nothing about money having been paid.
export async function recordWorksheetFiling(ctx, id, { arn, filedOn }, proof, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  if (!proof) throw new AppError(400, 'FILING_NOT_CONFIRMED', 'Attach the proof of filing from the GST portal');
  const first = await loadSheet(ctx, id);
  if (first.status === 'FILED' && first.filing?.arn === arn) return { filed: true }; // the same request again
  if (first.status !== 'APPROVED') throw new AppError(409, 'NOT_APPROVED', 'Approve this sheet first');
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').lean();
  if (filedOn > todayInZone(branch?.timezone ?? 'Asia/Kolkata')) throw new AppError(400, 'VALIDATION_ERROR', 'The filing date can’t be in the future');
  if (filedOn < `${first.period}-01`) throw new AppError(400, 'VALIDATION_ERROR', `The filing date can’t be before ${first.period}`);
  const filedReturn = await GstReturn.findOne(scoped(ctx, { gstin: first.gstin, period: first.period, status: 'FILED' })).select('_id').lean();
  if (!filedReturn) throw new AppError(409, 'NOT_FILED', 'Record GSTR-1 for this month as filed first');
  const proofFileId = await saveProof(proof, ctx.orgId);

  return runOnce(ctx, { key, operation: 'gst.worksheet.file' }, async (session) => {
    const filing = { arn, filedOn, confirmation: 'MANUALLY_CONFIRMED', proofFileId, proofName: proof.originalname, recordedByName: ctx.userName, recordedAt: new Date() };
    const updated = await GstWorksheet.updateOne({ _id: first._id, status: 'APPROVED', superseded: false }, { $set: { status: 'FILED', filing } }, { session });
    if (updated.modifiedCount !== 1) throw new AppError(409, 'NOT_APPROVED', 'Approve the latest revision of this sheet first');
    await GstReturn.updateOne({ _id: filedReturn._id }, { $set: { gstr3b: { arn, filedOn, recordedByName: ctx.userName, recordedAt: new Date() } } }, { session });
    await logActivity(ctx, { action: 'billing.gst_3b_recorded', summary: `Recorded GSTR-3B for ${first.gstin}, ${first.period} as filed, ARN ${arn}, manually confirmed`, after: { worksheetId: first._id, arn } }, session);
    return { filed: true };
  });
}
