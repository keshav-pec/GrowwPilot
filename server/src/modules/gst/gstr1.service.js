import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { BillingSettings, Branch, Counter, CustomerAdvance, GstAdjustment, GstRegistration, GstReturn, GstTaxEntry, GstTaxRule, GstWorksheet, InventorySku, Invoice, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { oid, scoped } from '../../utils/scoped.js';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { gstSetupActive } from './gst.billing.js';
import { ruleFor } from './gst.rules.js';
import { GSTR1_FORMAT, checkFormat, toPortalFile } from './gstr1.format.js';
import { buildGstr1, rulesFor } from './gstr1.rules.js';
import { openProof, saveProof } from './gst.proofs.js';
import { reviewRows } from './gstr1.review.js';

// ---------------------------------------------------------------------------
// GSTR-1: pick a GSTIN and month -> Prepare (reads the tax record up to that moment) -> fix what it lists at the source ->
// Rebuild (a new revision; the old one stays) -> Approve (that revision can't change) -> Export the file -> upload it on
// the GST portal -> Record filing with the ARN and proof. Exported never means Filed. The month then locks, and a
// correction is a case of its own: GSTR-1A before GSTR-3B is filed, otherwise a later-period amendment for review.
// ---------------------------------------------------------------------------

const INDIA = 'Asia/Kolkata';

export async function myGstins(ctx, session = null) {
  const registrations = await GstRegistration.find(scoped(ctx)).session(session).lean();
  const mine = registrations.filter((r) => ctx.isPrimaryOwner || r.branches.some((link) => ctx.allowedBranchIds.includes(String(link.branchId))));
  return { registrations, mine };
}

// The business owner sees all. A branch owner sees their GSTINs' returns if switched on, and works on them only if that is switched on too.
export function mayView(ctx, settings) {
  if (ctx.isPrimaryOwner) return;
  if (ctx.role !== 'OWNER' || !settings.branchOwners?.viewGst) throw new AppError(403, 'FORBIDDEN', 'The business owner hasn’t given you access to GST returns');
}
export function mayWork(ctx, settings) {
  if (ctx.isPrimaryOwner) return;
  if (ctx.role !== 'OWNER' || !settings.branchOwners?.approveReturns) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
}
export const canWork = (ctx, settings) => Boolean(ctx.isPrimaryOwner || (ctx.role === 'OWNER' && settings.branchOwners?.approveReturns));

async function loadReturn(ctx, id, session = null) {
  const found = await GstReturn.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Return not found');
  const { mine } = await myGstins(ctx, session);
  if (!mine.some((r) => r.gstin === found.gstin)) throw new AppError(404, 'NOT_FOUND', 'Return not found');
  return found;
}

// Everything that decides a month's return, up to this moment: its entries, and voids (from any month) of its bills
async function sourceOf(ctx, gstin, period, session) {
  const entries = await GstTaxEntry.find(scoped(ctx, { gstin, period })).sort({ taxDate: 1, createdAt: 1, _id: 1 }).session(session).lean();
  const invoiceIds = entries.filter((e) => e.type === 'BILL_ISSUED').map((e) => e.invoiceId);
  const voids = await GstTaxEntry.find(scoped(ctx, { type: 'BILL_VOIDED', invoiceId: { $in: invoiceIds } })).select('invoiceId sourceKey').session(session).lean();
  const hash = createHash('sha256').update([...entries.map((e) => e.sourceKey), ...voids.map((v) => v.sourceKey)].sort().join('\n')).digest('hex');
  return { entries, voids, hash };
}

// What each bill line needs for Table 12: its code and official unit. Codes on the entry win. An older bill with none
// takes its service's or product's rule now, which is how a missing code gets fixed.
async function lookups(ctx, settings, entries, session) {
  const invoiceIds = [...new Set(entries.map((e) => e.invoiceId).filter(Boolean).map(String))];
  const invoices = await Invoice.find({ _id: { $in: invoiceIds }, orgId: oid(ctx.orgId) }).select('lines._id lines.skuId lines.serviceId').session(session).lean();
  const lineInfo = new Map(invoices.flatMap((i) => i.lines.map((l) => [String(l._id), l])));
  const skuIds = [...lineInfo.values()].map((l) => l.skuId).filter(Boolean);
  const serviceIds = [...lineInfo.values()].map((l) => l.serviceId).filter(Boolean);
  const [skus, services, rules] = [
    await InventorySku.find(scoped(ctx, { _id: { $in: skuIds } })).select('stockUnit hsnCode taxRuleGroupId').session(session).lean(),
    await Service.find(scoped(ctx, { _id: { $in: serviceIds } })).select('sacCode taxRuleGroupId').session(session).lean(),
    await GstTaxRule.find(scoped(ctx, { status: 'APPROVED' })).session(session).lean(),
  ];
  const find = (list, id) => list.find((x) => String(x._id) === String(id));
  const unitCodes = settings.gst?.unitCodes ?? {};
  return {
    codeOf(line, entry) {
      if (line.code) return line.code;
      const info = lineInfo.get(String(line.lineId));
      const source = info?.skuId ? find(skus, info.skuId) : find(services, info?.serviceId);
      return ruleFor(rules, source?.taxRuleGroupId, entry.taxDate)?.code || source?.sacCode || source?.hsnCode || (info?.skuId ? null : settings.defaultSacCode) || null;
    },
    // Table 12 adds up many services under one code, so a rule's name says more than the first service's
    describe(line) {
      return find(rules, line.taxRuleId)?.name ?? line.name;
    },
    unitOf(line) {
      const sku = find(skus, lineInfo.get(String(line.lineId))?.skuId);
      return sku ? unitCodes[sku.stockUnit] ?? null : null;
    },
  };
}

async function plainAdvanceTaken(ctx, registrations, gstin, period, session) {
  const inMonth = (link) => link.from.slice(0, 7) <= period && (!link.to || link.to.slice(0, 7) >= period);
  const ids = registrations.filter((r) => r.gstin === gstin).flatMap((r) => r.branches.filter(inMonth).map((l) => l.branchId));
  const branches = await Branch.find(scoped(ctx, { _id: { $in: ids } })).select('timezone').session(session).lean();
  if (branches.length === 0) return 0;
  const last = DateTime.fromISO(`${period}-01`).endOf('month').toISODate();
  const advances = await CustomerAdvance.find({
    orgId: oid(ctx.orgId),
    taxed: { $ne: true },
    $or: branches.map((b) => ({ branchId: b._id, createdAt: { $gte: dayRangeUTC(`${period}-01`, b.timezone).start, $lt: dayRangeUTC(last, b.timezone).end } })),
  }).select('amount').session(session).lean();
  return advances.reduce((sum, a) => sum + a.amount, 0);
}

async function build(ctx, settings, { gstin, period, entries, voids, rules, plain = 0, correction = false }, session) {
  const allBills = await GstTaxEntry.find(scoped(ctx, { type: 'BILL_ISSUED', invoiceId: { $in: entries.map((e) => e.invoiceId).filter(Boolean) } })).session(session).lean();
  const { codeOf, unitOf, describe } = await lookups(ctx, settings, entries, session);
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').session(session).lean();
  return buildGstr1({
    entries,
    voidedInvoiceIds: new Set(voids.map((v) => String(v.invoiceId))),
    originals: new Map(allBills.map((b) => [String(b.invoiceId), b])),
    codeOf,
    unitOf,
    describe,
    correction,
    plainAdvanceTaken: plain,
    rules,
    period,
    gstin,
    today: todayInZone(branch?.timezone ?? INDIA),
  });
}

// Prepare and Rebuild are the same: a new revision from the record as it is now. Earlier revisions stay.
// Two people at once get two coherent revisions: the revision number comes from one counter, in the transaction.
export async function prepareReturn(ctx, { gstin, period }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  if (!gstSetupActive(settings)) throw new AppError(409, 'GST_NOT_ACTIVE', 'Activate GST setup first');
  if (settings.gst.scheme !== 'REGULAR') throw new AppError(409, 'REGIME_NOT_SUPPORTED', 'Returns are only supported for regular registrations');
  if (period < settings.gst.startMonth) throw new AppError(400, 'BEFORE_START_MONTH', `Your returns from the app begin in ${settings.gst.startMonth}`);
  const rules = rulesFor(period);
  if (!rules) throw new AppError(400, 'PERIOD_NOT_SUPPORTED', 'Months before May 2025 aren’t supported');

  return runOnce(ctx, { key, operation: 'gst.return.prepare' }, async (session) => {
    const { registrations, mine } = await myGstins(ctx, session);
    const registration = mine.find((r) => r.gstin === gstin);
    if (!registration) throw new AppError(404, 'NOT_FOUND', 'GSTIN not found');
    if (await GstReturn.exists(scoped(ctx, { gstin, period, status: 'FILED' })).session(session)) {
      throw new AppError(409, 'FILED_PERIOD_LOCKED', 'This month has been filed, so it can’t change. Create an adjustment case instead.');
    }
    const { entries, voids, hash } = await sourceOf(ctx, gstin, period, session);
    const plain = await plainAdvanceTaken(ctx, registrations, gstin, period, session);
    const built = await build(ctx, settings, { gstin, period, entries, voids, rules, plain }, session);
    const file = toPortalFile(built.tables, { gstin, period });
    const formatProblems = checkFormat(file);
    const issues = [...built.issues];
    if (!issues.some((i) => i.severity === 'BLOCKER')) {
      for (const problem of formatProblems.slice(0, 20)) issues.push({ severity: 'BLOCKER', code: 'FILE_FORMAT', message: `The file doesn’t fit the GST format at ${problem.path}: ${problem.message}`, table: problem.path.split('.')[0] });
    }
    const counter = await Counter.findOneAndUpdate({ _id: `gstreturn:${ctx.orgId}:${gstin}:${period}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    await GstReturn.updateMany(scoped(ctx, { gstin, period, superseded: false }), { $set: { superseded: true } }, { session });
    const [created] = await GstReturn.create(
      [{
        orgId: ctx.orgId,
        gstin,
        legalName: registration.legalName,
        period,
        revision: counter.seq,
        status: issues.some((i) => i.severity === 'BLOCKER') ? 'NEEDS_FIXING' : 'READY',
        cutoffAt: new Date(),
        rules,
        tables: built.tables,
        totals: built.totals,
        lineage: built.lineage,
        excluded: built.excluded,
        issues,
        entryCount: entries.length,
        sourceHash: hash,
        preparedBy: ctx.userId,
        preparedByName: ctx.userName,
      }],
      { session }
    );
    await logActivity(ctx, { action: 'billing.gst_return_prepared', summary: `Prepared GSTR-1 for ${gstin}, ${period}, revision ${counter.seq}: ${issues.filter((i) => i.severity === 'BLOCKER').length} to fix`, after: { returnId: created._id, revision: counter.seq } }, session);
    return { returnId: created._id, revision: counter.seq, status: created.status };
  });
}

async function assertUpToDate(ctx, found, session) {
  const { hash } = await sourceOf(ctx, found.gstin, found.period, session);
  if (hash !== found.sourceHash) throw new AppError(409, 'RETURN_OUT_OF_DATE', 'The tax record has changed since this revision was prepared. Rebuild to make a new revision.');
}

const isLatest = (found) => {
  if (found.superseded) throw new AppError(409, 'RETURN_SUPERSEDED', 'A newer revision of this return exists. Open that one.');
};

// Approving writes the file. From here the revision's figures can't change, and the file is checked against the format.
export async function approveReturn(ctx, id, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadReturn(ctx, id);
  return runOnce(ctx, { key, operation: 'gst.return.approve' }, async (session) => {
    const found = await loadReturn(ctx, first._id, session);
    isLatest(found);
    if (found.status === 'NEEDS_FIXING') throw new AppError(409, 'RETURN_VALIDATION_BLOCKED', 'Fix what is listed first, then rebuild.');
    if (found.status !== 'READY') throw new AppError(409, 'ALREADY_APPROVED', 'This revision has already been approved');
    await assertUpToDate(ctx, found, session);
    const file = toPortalFile(found.tables, { gstin: found.gstin, period: found.period });
    const problems = checkFormat(file);
    if (problems.length > 0) throw new AppError(409, 'RETURN_VALIDATION_BLOCKED', `The file doesn’t fit the GST format at ${problems[0].path}: ${problems[0].message}`, { problems });
    const updated = await GstReturn.updateOne(
      { _id: found._id, status: 'READY' },
      { $set: { status: 'APPROVED', json: file, formatVersion: GSTR1_FORMAT.version, approvedBy: ctx.userId, approvedByName: ctx.userName, approvedAt: new Date() } },
      { session }
    );
    if (updated.modifiedCount !== 1) throw new AppError(409, 'ALREADY_APPROVED', 'This revision has already been approved');
    await logActivity(ctx, { action: 'billing.gst_return_approved', summary: `Approved GSTR-1 for ${found.gstin}, ${found.period}, revision ${found.revision}`, after: { returnId: found._id } }, session);
    return { approved: true };
  });
}

// The file for the GST portal. The first download marks it Exported, which never means Filed.
export async function exportReturn(ctx, id) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const found = await loadReturn(ctx, id);
  if (!found.json) throw new AppError(409, 'NOT_APPROVED', 'Approve this revision first');
  await GstReturn.updateOne(
    { _id: found._id },
    { $push: { exports: { at: new Date(), byName: ctx.userName } }, ...(found.status === 'APPROVED' ? { $set: { status: 'EXPORTED' } } : {}) }
  );
  await logActivity(ctx, { action: 'billing.gst_return_exported', summary: `Downloaded the GSTR-1 file for ${found.gstin}, ${found.period}, revision ${found.revision}`, after: { returnId: found._id } });
  const [year, month] = found.period.split('-');
  return { fileName: `GSTR1_${found.gstin}_${month}${year}_rev${found.revision}.json`, file: found.json };
}

// The portal turned the upload down. Each line of what it said is matched to its document where possible, and a new revision follows.
// text: the portal's errors, one per line, e.g. "AND/26-27/00004: invalid HSN"
export async function markRejected(ctx, id, { text }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadReturn(ctx, id);
  return runOnce(ctx, { key, operation: 'gst.return.reject' }, async (session) => {
    const found = await loadReturn(ctx, first._id, session);
    isLatest(found);
    if (found.status !== 'EXPORTED') throw new AppError(409, 'NOT_EXPORTED', 'Only an exported revision can be marked as rejected');
    const { entries } = await sourceOf(ctx, found.gstin, found.period, session);
    const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 200).map((message) => {
      const entry = entries.find((e) => message.toUpperCase().includes(e.documentNumber.toUpperCase()));
      return { documentNumber: entry?.documentNumber, message, link: entry ? (entry.invoiceId ? `/app/invoices/${entry.invoiceId}` : `/app/advances/${entry.advanceId}`) : undefined };
    });
    await GstReturn.updateOne({ _id: found._id, status: 'EXPORTED' }, { $set: { status: 'REJECTED', rejection: { at: new Date(), byName: ctx.userName, rows } } }, { session });
    await logActivity(ctx, { action: 'billing.gst_return_rejected', summary: `Marked GSTR-1 for ${found.gstin}, ${found.period}, revision ${found.revision} as rejected by the portal`, after: { returnId: found._id, rows: rows.length } }, session);
    return { rejected: true };
  });
}

// A filing date can't be in the future, or before the month it is for
async function assertFilingDate(ctx, period, filedOn) {
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').lean();
  if (filedOn > todayInZone(branch?.timezone ?? INDIA)) throw new AppError(400, 'VALIDATION_ERROR', 'The filing date can’t be in the future');
  if (filedOn < `${period}-01`) throw new AppError(400, 'VALIDATION_ERROR', `The filing date can’t be before ${period}`);
}

// Filing happens on the GST portal. This records it, by hand, with the ARN and proof, and locks the month.
export async function recordFiling(ctx, id, { arn, filedOn }, proof, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  if (!proof) throw new AppError(400, 'FILING_NOT_CONFIRMED', 'Attach the proof of filing from the GST portal');
  const first = await loadReturn(ctx, id);
  if (first.status === 'FILED' && first.filing?.arn === arn) return { filed: true }; // the same request again
  if (first.status !== 'EXPORTED') throw new AppError(409, 'NOT_EXPORTED', 'Only an exported revision can be recorded as filed');
  await assertFilingDate(ctx, first.period, filedOn);
  isLatest(first);
  await assertUpToDate(ctx, first, null);
  const proofFileId = await saveProof(proof, ctx.orgId);

  return runOnce(ctx, { key, operation: 'gst.return.file' }, async (session) => {
    const found = await loadReturn(ctx, first._id, session);
    await assertUpToDate(ctx, found, session);
    const filing = { arn, filedOn, confirmation: 'MANUALLY_CONFIRMED', proofFileId, proofName: proof.originalname, recordedByName: ctx.userName, recordedAt: new Date() };
    const updated = await GstReturn.updateOne({ _id: found._id, status: 'EXPORTED', superseded: false }, { $set: { status: 'FILED', filing } }, { session });
    if (updated.modifiedCount !== 1) throw new AppError(409, 'NOT_EXPORTED', 'Only an exported revision can be recorded as filed');
    await logActivity(ctx, { action: 'billing.gst_return_filed', summary: `Recorded GSTR-1 for ${found.gstin}, ${found.period} as filed, ARN ${arn}, manually confirmed`, after: { returnId: found._id, arn, filedOn } }, session);
    return { filed: true };
  });
}

// ---- after filing ----------------------------------------------------------

// Entries of a filed month that its return (and any correction since) doesn't cover
async function leftOut(ctx, filed, session = null) {
  const covered = new Set([...filed.lineage.flatMap((l) => l.entryIds.map(String)), ...filed.excluded.map((e) => String(e.entryId))]);
  const cases = await GstAdjustment.find(scoped(ctx, { returnId: filed._id })).select('entryIds').session(session).lean();
  for (const c of cases) for (const id of c.entryIds) covered.add(String(id));
  const entries = await GstTaxEntry.find(scoped(ctx, { gstin: filed.gstin, period: filed.period })).sort({ taxDate: 1, _id: 1 }).session(session).lean();
  return entries.filter((e) => !covered.has(String(e._id)));
}

// A correction to a filed month. Before GSTR-3B: a GSTR-1A draft holding only what changed, never a new GSTR-1.
// After GSTR-3B: GSTR-1A is closed, so it goes to a later-period amendment for review, with no file from the app.
export async function createAdjustment(ctx, returnId, { reason, invoiceId = null }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const filed = await loadReturn(ctx, returnId);
  if (filed.status !== 'FILED') throw new AppError(409, 'NOT_FILED', 'Only a filed month needs an adjustment case');

  return runOnce(ctx, { key, operation: 'gst.adjustment.create' }, async (session) => {
    const omitted = await leftOut(ctx, filed, session);
    const route = filed.gstr3b?.arn ? 'LATER_AMENDMENT' : 'GSTR_1A';
    const doc = { orgId: ctx.orgId, returnId: filed._id, gstin: filed.gstin, period: filed.period, route, reason: reason.trim(), invoiceId: invoiceId ?? undefined, entryIds: omitted.map((e) => e._id), createdByName: ctx.userName };

    if (route === 'GSTR_1A' && omitted.length > 0) {
      const voids = omitted.filter((e) => e.type === 'BILL_VOIDED').map((e) => ({ invoiceId: e.invoiceId, sourceKey: e.sourceKey }));
      const built = await build(ctx, settings, { gstin: filed.gstin, period: filed.period, entries: omitted, voids, rules: filed.rules, correction: true }, session);
      const blockers = built.issues.filter((i) => i.severity === 'BLOCKER');
      const file = toPortalFile(built.tables, { gstin: filed.gstin, period: filed.period });
      Object.assign(doc, { tables: built.tables, totals: built.totals, issues: built.issues, status: blockers.length > 0 ? 'NEEDS_REVIEW' : 'DRAFT', json: blockers.length > 0 ? undefined : file });
    } else {
      // Nothing left out to send (e.g. a change wanted to something already filed), or GSTR-1A is closed: a person decides
      doc.status = 'NEEDS_REVIEW';
      doc.issues = [{ severity: 'WARNING', code: 'AMENDMENT_REVIEW_REQUIRED', message: route === 'LATER_AMENDMENT' ? 'GSTR-3B for this month has been filed, so GSTR-1A is closed. Your tax person needs to amend this in a later month’s return.' : 'Nothing was left out of the filed return. Your tax person needs to decide how to correct this, for example with a credit note in the current month.' }];
    }
    const [created] = await GstAdjustment.create([doc], { session });
    await logActivity(ctx, { action: 'billing.gst_adjustment_created', summary: `Opened a correction for GSTR-1 of ${filed.gstin}, ${filed.period}: ${route === 'GSTR_1A' ? 'GSTR-1A' : 'later-period amendment'}. ${reason.trim()}`, after: { adjustmentId: created._id, route, entries: omitted.length } }, session);
    return { adjustmentId: created._id, route, status: created.status };
  });
}

async function loadAdjustment(ctx, id) {
  const found = await GstAdjustment.findOne(scoped(ctx, { _id: id })).lean();
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Case not found');
  const { mine } = await myGstins(ctx);
  if (!mine.some((r) => r.gstin === found.gstin)) throw new AppError(404, 'NOT_FOUND', 'Case not found');
  return found;
}

export async function exportAdjustment(ctx, id) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const found = await loadAdjustment(ctx, id);
  if (!found.json) throw new AppError(409, 'AMENDMENT_REVIEW_REQUIRED', 'This case has no file: it needs your tax person’s review');
  if (found.status === 'DRAFT') await GstAdjustment.updateOne({ _id: found._id }, { $set: { status: 'EXPORTED' } });
  const [year, month] = found.period.split('-');
  return { fileName: `GSTR1A_${found.gstin}_${month}${year}.json`, file: found.json };
}

export async function recordAdjustmentFiled(ctx, id, { arn, filedOn }, proof, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  if (!proof) throw new AppError(400, 'FILING_NOT_CONFIRMED', 'Attach the proof of filing from the GST portal');
  const found = await loadAdjustment(ctx, id);
  if (found.status === 'FILED' && found.filing?.arn === arn) return { filed: true }; // the same request again
  if (found.status !== 'EXPORTED') throw new AppError(409, 'NOT_EXPORTED', 'Only an exported correction can be recorded as filed');
  await assertFilingDate(ctx, found.period, filedOn);
  const proofFileId = await saveProof(proof, ctx.orgId);
  return runOnce(ctx, { key, operation: 'gst.adjustment.file' }, async (session) => {
    await GstAdjustment.updateOne({ _id: found._id, status: 'EXPORTED' }, { $set: { status: 'FILED', filing: { arn, filedOn, proofFileId, proofName: proof.originalname, recordedByName: ctx.userName, recordedAt: new Date() } } }, { session });
    await logActivity(ctx, { action: 'billing.gst_adjustment_filed', summary: `Recorded GSTR-1A for ${found.gstin}, ${found.period} as filed, ARN ${arn}, manually confirmed`, after: { adjustmentId: found._id, arn } }, session);
    return { filed: true };
  });
}

// ---- reading ---------------------------------------------------------------

// Months for a GSTIN, from the start month to this one, each with its latest revision
export async function listReturns(ctx, { gstin }) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const { mine } = await myGstins(ctx);
  const gstins = [...new Map(mine.map((r) => [r.gstin, { gstin: r.gstin, legalName: r.legalName }])).values()];
  const chosen = gstin ?? gstins[0]?.gstin;
  if (gstin && !gstins.some((g) => g.gstin === gstin)) throw new AppError(404, 'NOT_FOUND', 'GSTIN not found');
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').lean();
  const thisMonth = todayInZone(branch?.timezone ?? INDIA).slice(0, 7);
  const months = [];
  if (settings.gst?.startMonth && gstSetupActive(settings)) {
    for (let m = DateTime.fromISO(`${thisMonth}-01`); m.toFormat('yyyy-MM') >= settings.gst.startMonth && months.length < 36; m = m.minus({ months: 1 })) months.push(m.toFormat('yyyy-MM'));
  }
  const latest = await GstReturn.find(scoped(ctx, { gstin: chosen, superseded: false })).select('period revision status totals filing.arn issues').lean();
  const sheets = await GstWorksheet.find(scoped(ctx, { gstin: chosen, superseded: false })).select('period revision status filing.arn').lean();
  return {
    active: gstSetupActive(settings),
    gstins,
    gstin: chosen ?? null,
    canWork: canWork(ctx, settings),
    months: months.map((period) => {
      const r = latest.find((x) => x.period === period);
      const sheet = sheets.find((x) => x.period === period);
      return { period, returnId: r?._id ?? null, revision: r?.revision ?? null, status: r?.status ?? 'NOT_PREPARED', taxable: r?.totals?.taxable ?? null, tax: r?.totals?.tax ?? null, arn: r?.filing?.arn ?? null, toFix: r?.issues?.filter((i) => i.severity === 'BLOCKER').length ?? 0, worksheetId: sheet?._id ?? null, worksheetStatus: sheet?.status ?? null };
    }),
  };
}

export async function getReturn(ctx, id) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const found = await loadReturn(ctx, id);
  const { json, lineage, ...rest } = found;
  const revisions = await GstReturn.find(scoped(ctx, { gstin: found.gstin, period: found.period })).select('revision status superseded createdAt preparedByName').sort({ revision: -1 }).lean();
  const adjustments = await GstAdjustment.find(scoped(ctx, { returnId: found._id })).select('-json -tables').sort({ createdAt: -1 }).lean();
  const { hash } = await sourceOf(ctx, found.gstin, found.period, null);
  const left = found.status === 'FILED' ? await leftOut(ctx, found) : [];
  return {
    ...rest,
    review: reviewRows(found.tables),
    counts: Object.fromEntries(lineage.map((l) => [l.row, l.entryIds.length])),
    outOfDate: hash !== found.sourceHash,
    revisions,
    adjustments,
    leftOut: left.map((e) => ({ _id: e._id, documentNumber: e.documentNumber, total: e.total, link: e.invoiceId ? `/app/invoices/${e.invoiceId}` : `/app/advances/${e.advanceId}` })),
    canWork: canWork(ctx, settings),
    format: { version: GSTR1_FORMAT.version, checkedAgainstPortal: GSTR1_FORMAT.checkedAgainstPortal },
  };
}

// The entries behind one figure. A branch owner only gets their own branches' documents.
export async function returnTrail(ctx, id, row) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const found = await loadReturn(ctx, id);
  const trace = found.lineage.find((l) => l.row === row);
  if (!trace) throw new AppError(404, 'NOT_FOUND', 'That figure was not found');
  const filter = ctx.isPrimaryOwner ? {} : { branchId: { $in: ctx.allowedBranchIds.map(oid) } };
  const entries = await GstTaxEntry.find(scoped(ctx, { _id: { $in: trace.entryIds }, ...filter })).select('documentNumber type taxDate customerName taxable cgst sgst igst total invoiceId advanceId').sort({ taxDate: 1 }).lean();
  return {
    row,
    total: trace.entryIds.length,
    entries: entries.map((e) => ({ ...e, link: e.invoiceId ? `/app/invoices/${e.invoiceId}` : `/app/advances/${e.advanceId}` })),
  };
}

// A proof of filing, for those who may see that GSTIN's returns
export async function filingProof(ctx, proofId) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const owner = (await GstReturn.findOne(scoped(ctx, { 'filing.proofFileId': proofId })).select('gstin').lean()) ?? (await GstAdjustment.findOne(scoped(ctx, { 'filing.proofFileId': proofId })).select('gstin').lean()) ?? (await GstWorksheet.findOne(scoped(ctx, { 'filing.proofFileId': proofId })).select('gstin').lean());
  const { mine } = await myGstins(ctx);
  if (!owner || !mine.some((r) => r.gstin === owner.gstin)) throw new AppError(404, 'NOT_FOUND', 'Proof not found');
  const proof = await openProof(proofId, ctx.orgId);
  if (!proof) throw new AppError(404, 'NOT_FOUND', 'Proof not found');
  return proof;
}

export async function reviewOf(ctx, id) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  return loadReturn(ctx, id);
}

// ---- units for Table 12 ----------------------------------------------------
export async function saveUnitCodes(ctx, { units }, key) {
  if (!ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can change GST setup');
  return runOnce(ctx, { key, operation: 'gst.units.save' }, async (session) => {
    const set = Object.fromEntries(Object.entries(units).map(([unit, code]) => [`gst.unitCodes.${unit}`, code]));
    await BillingSettings.updateOne(scoped(ctx), { $set: set }, { upsert: true, session });
    await logActivity(ctx, { action: 'billing.gst_units_saved', summary: `Set official unit codes: ${Object.entries(units).map(([u, c]) => `${u} = ${c}`).join(', ')}`, after: units }, session);
    return { saved: true };
  });
}

