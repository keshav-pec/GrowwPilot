import { createHash } from 'node:crypto';
import { Gst2bImport, GstItcDecision, GstPurchaseBill, GstWorksheet, InventoryGoodsReceipt, InventorySupplier } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { canWork, mayView, mayWork, myGstins } from './gstr1.service.js';
import { checkDecision, matchKeyOf, matchPurchases, parse2bCsv, parse2bJson, suggestItc, taxOf, validSupplierGstin } from './gst.purchases.rules.js';

// ---------------------------------------------------------------------------
// Purchases & ITC: enter supplier bills, import GSTR-2B (a read-only statement), compare them, then decide each bill's
// credit with a reason. A match alone never claims anything. Once a month's GSTR-3B is recorded as filed, it locks.
// ---------------------------------------------------------------------------

async function assertMyGstin(ctx, gstin, session = null) {
  const { mine } = await myGstins(ctx, session);
  if (!mine.some((r) => r.gstin === gstin)) throw new AppError(404, 'NOT_FOUND', 'GSTIN not found');
}

export async function assertPurchasesOpen(ctx, gstin, period, session = null) {
  if (await GstWorksheet.exists(scoped(ctx, { gstin, period, status: 'FILED' })).session(session)) {
    throw new AppError(409, 'FILED_PERIOD_LOCKED', `GSTR-3B for ${period} has been filed, so its purchases and credit can’t change. Add the bill to a later month, or ask your tax person.`);
  }
}

const activeBills = (ctx, filter, session = null) => GstPurchaseBill.find(scoped(ctx, { 'cancelled.at': null, ...filter })).sort({ billDate: 1, _id: 1 }).session(session).lean();
const currentImport = (ctx, gstin, period, session = null) => Gst2bImport.findOne(scoped(ctx, { gstin, period })).sort({ createdAt: -1, _id: -1 }).session(session).lean();

// The month's bills against its GSTR-2B, each with its suggestion and the decision that stands
export async function purchaseGrid(ctx, gstin, period, session = null) {
  const [bills, imported, allBills, decisions] = [
    await activeBills(ctx, { gstin, period }, session),
    await currentImport(ctx, gstin, period, session),
    await activeBills(ctx, { gstin }, session),
    await GstItcDecision.find(scoped(ctx, { gstin, period })).sort({ createdAt: 1, _id: 1 }).session(session).lean(),
  ];
  const grid = matchPurchases(bills, imported ? imported.rows : null, allBills);
  const rows = grid.map((row) => {
    const history = decisions.filter((d) => (row.bill ? String(d.billId) === String(row.bill._id) : d.rowKey === row.key));
    const decision = row.bill ? history.find((d) => String(d._id) === String(row.bill.decisionId)) ?? null : history.at(-1) ?? null;
    const suggestion = row.bill ? suggestItc(row.bill) : null;
    // Done: a decision stands, and it was made on the status the row has now
    const resolved = row.status !== 'DUPLICATE' && Boolean(decision) && decision.matchStatus === row.status;
    return { ...row, suggestion, decision, history, resolved };
  });
  return { rows, imported, decisions };
}

// The Purchases & ITC screen
export async function purchasesScreen(ctx, { gstin, period }) {
  const settings = await getBillingSettings(ctx);
  mayView(ctx, settings);
  const { mine } = await myGstins(ctx);
  const gstins = [...new Map(mine.map((r) => [r.gstin, { gstin: r.gstin, legalName: r.legalName }])).values()];
  const chosen = gstin ?? gstins[0]?.gstin;
  if (gstin && !gstins.some((g) => g.gstin === gstin)) throw new AppError(404, 'NOT_FOUND', 'GSTIN not found');
  if (!chosen) return { gstins, gstin: null, period, rows: [], summary: {}, imported: null, canWork: canWork(ctx, settings), locked: false };
  const { rows, imported } = await purchaseGrid(ctx, chosen, period);
  const claimed = rows.filter((r) => r.decision).reduce((sum, r) => sum + taxOf(r.decision.eligible), 0);
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const locked = Boolean(await GstWorksheet.exists(scoped(ctx, { gstin: chosen, period, status: 'FILED' })));
  return {
    gstins,
    gstin: chosen,
    period,
    rows,
    imported: imported ? { fileName: imported.fileName, source: imported.source, rowCount: imported.rows.length, importedByName: imported.importedByName, at: imported.createdAt } : null,
    summary: { counts, unresolved: rows.filter((r) => !r.resolved).length, claimed, booksTax: rows.reduce((s, r) => s + (r.bill ? taxOf(r.bill) : 0), 0), portalTax: rows.reduce((s, r) => s + (r.portal ? taxOf(r.portal) : 0), 0) },
    canWork: canWork(ctx, settings),
    locked,
  };
}

// A supplier's bill. The same supplier and number again is saved and shown as a duplicate, so nothing is lost or claimed twice.
// input: { gstin, period, supplierId?, supplierName, supplierGstin, billNumber, billDate, taxable, igst, cgst, sgst, use, receiptId?, note? }
export async function addPurchase(ctx, input, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  await assertMyGstin(ctx, input.gstin);
  if (!validSupplierGstin(input.supplierGstin)) throw new AppError(400, 'SUPPLIER_GSTIN_INVALID', 'The supplier’s GSTIN doesn’t look right. Please check it.', { field: 'supplierGstin' });
  if (input.billDate.slice(0, 7) > input.period) throw new AppError(400, 'VALIDATION_ERROR', 'A bill can’t belong to a month before its date', { field: 'period' });
  if (input.igst > 0 && (input.cgst > 0 || input.sgst > 0)) throw new AppError(400, 'VALIDATION_ERROR', 'A bill has IGST, or CGST and SGST, not both', { field: 'igst' });

  return runOnce(ctx, { key, operation: 'gst.purchase.add' }, async (session) => {
    await assertPurchasesOpen(ctx, input.gstin, input.period, session);
    if (input.supplierId && !(await InventorySupplier.exists(scoped(ctx, { _id: input.supplierId })).session(session))) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
    if (input.receiptId && !(await InventoryGoodsReceipt.exists(scoped(ctx, { _id: input.receiptId })).session(session))) throw new AppError(404, 'NOT_FOUND', 'Delivery not found');
    const [bill] = await GstPurchaseBill.create(
      [{ ...input, supplierGstin: input.supplierGstin.toUpperCase(), matchKey: matchKeyOf(input.supplierGstin, input.billNumber), orgId: ctx.orgId, createdBy: ctx.userId, createdByName: ctx.userName }],
      { session }
    );
    await logActivity(ctx, { action: 'billing.gst_purchase_added', summary: `Added purchase bill ${input.billNumber} from ${input.supplierName}: ${formatMoney(input.taxable)} + ${formatMoney(taxOf(input))} GST`, after: { billId: bill._id, gstin: input.gstin, period: input.period } }, session);
    return { billId: bill._id };
  });
}

async function loadBill(ctx, id, session = null) {
  const bill = await GstPurchaseBill.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!bill) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  await assertMyGstin(ctx, bill.gstin, session);
  return bill;
}

// A bill entered by mistake, or a duplicate. It stays on record, marked cancelled, and its credit goes.
export async function cancelPurchase(ctx, id, { reason }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadBill(ctx, id);
  return runOnce(ctx, { key, operation: 'gst.purchase.cancel' }, async (session) => {
    await assertPurchasesOpen(ctx, first.gstin, first.period, session);
    const updated = await GstPurchaseBill.updateOne(scoped(ctx, { _id: first._id, 'cancelled.at': null }), { $set: { cancelled: { reason: reason.trim(), at: new Date(), byName: ctx.userName }, decisionId: null } }, { session });
    if (updated.modifiedCount !== 1) throw new AppError(409, 'ALREADY_CANCELLED', 'This bill has already been cancelled');
    await logActivity(ctx, { action: 'billing.gst_purchase_cancelled', summary: `Cancelled purchase bill ${first.billNumber} from ${first.supplierName}: ${reason.trim()}`, after: { billId: first._id } }, session);
    return { cancelled: true };
  });
}

// Import GSTR-2B for a GSTIN and month. The same file twice is recognised and not counted again.
export async function import2b(ctx, { gstin, period }, file, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  await assertMyGstin(ctx, gstin);
  if (!file) throw new AppError(400, 'VALIDATION_ERROR', 'Choose the GSTR-2B file');
  const text = file.buffer.toString('utf8');
  const isCsv = file.originalname.toLowerCase().endsWith('.csv');
  const parsed = isCsv ? parse2bCsv(text) : parse2bJson(text);
  if (parsed.gstin && parsed.gstin !== gstin) throw new AppError(400, 'WRONG_2B_FILE', `This file is for GSTIN ${parsed.gstin}, not ${gstin}.`);
  if (parsed.period && parsed.period !== period) throw new AppError(400, 'WRONG_2B_FILE', `This file is for ${parsed.period}, not ${period}.`);
  const bad = parsed.rows.find((r) => !validSupplierGstin(r.supplierGstin) || !r.billNumber);
  if (bad) throw new AppError(400, 'FILE_NOT_READABLE', `A row in this file has no valid supplier GSTIN or bill number: ${bad.supplierGstin || '(no GSTIN)'} ${bad.billNumber}`);
  const fileHash = createHash('sha256').update(file.buffer).digest('hex');

  return runOnce(ctx, { key, operation: 'gst.2b.import' }, async (session) => {
    await assertPurchasesOpen(ctx, gstin, period, session);
    const earlier = await Gst2bImport.findOne(scoped(ctx, { gstin, period, fileHash })).select('_id rows').session(session).lean();
    if (earlier) return { alreadyImported: true, rowCount: earlier.rows.length };
    const [created] = await Gst2bImport.create([{ orgId: ctx.orgId, gstin, period, fileHash, fileName: file.originalname, source: isCsv ? 'CSV' : 'JSON', rows: parsed.rows, importedBy: ctx.userId, importedByName: ctx.userName }], { session });
    await logActivity(ctx, { action: 'billing.gst_2b_imported', summary: `Imported GSTR-2B for ${gstin}, ${period}: ${parsed.rows.length} rows`, after: { importId: created._id, fileHash } }, session);
    return { alreadyImported: false, rowCount: parsed.rows.length };
  });
}

// The owner decides a bill's credit, with a reason. A new decision replaces the last; the last stays on record.
// eligible: { igst, cgst, sgst } in paise; the rest of the bill's tax is not claimed.
export async function decideItc(ctx, id, { eligible, reason }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  const first = await loadBill(ctx, id);
  if (first.cancelled?.at) throw new AppError(409, 'ALREADY_CANCELLED', 'This bill has been cancelled');
  return runOnce(ctx, { key, operation: 'gst.itc.decide' }, async (session) => {
    await assertPurchasesOpen(ctx, first.gstin, first.period, session);
    const { rows } = await purchaseGrid(ctx, first.gstin, first.period, session);
    const row = rows.find((r) => r.key === String(first._id));
    const checked = checkDecision(first, row.status, eligible);
    const [decision] = await GstItcDecision.create(
      [{ orgId: ctx.orgId, gstin: first.gstin, period: first.period, billId: first._id, documentNumber: first.billNumber, supplierName: first.supplierName, matchStatus: row.status, use: first.use, ...checked, reason: reason.trim(), decidedBy: ctx.userId, decidedByName: ctx.userName }],
      { session }
    );
    await GstPurchaseBill.updateOne({ _id: first._id }, { $set: { decisionId: decision._id } }, { session });
    await logActivity(ctx, { action: 'billing.gst_itc_decided', summary: `Decided the credit on purchase bill ${first.billNumber} from ${first.supplierName}: ${formatMoney(taxOf(checked.eligible))} claimed, ${formatMoney(taxOf(checked.notEligible))} not claimed. ${reason.trim()}`, after: { decisionId: decision._id } }, session);
    return { decisionId: decision._id };
  });
}

// A GSTR-2B row with no bill in the books: decide not to claim it. To claim it, add the bill.
export async function decideMissingRow(ctx, { gstin, period, rowKey, reason }, key) {
  const settings = await getBillingSettings(ctx);
  mayWork(ctx, settings);
  await assertMyGstin(ctx, gstin);
  return runOnce(ctx, { key, operation: 'gst.itc.decide_missing' }, async (session) => {
    await assertPurchasesOpen(ctx, gstin, period, session);
    const { rows } = await purchaseGrid(ctx, gstin, period, session);
    const row = rows.find((r) => r.key === rowKey && r.status === 'MISSING_IN_BOOKS');
    if (!row) throw new AppError(404, 'NOT_FOUND', 'That GSTR-2B row was not found');
    const zero = { igst: 0, cgst: 0, sgst: 0 };
    const notEligible = { igst: row.portal.igst, cgst: row.portal.cgst, sgst: row.portal.sgst };
    const [decision] = await GstItcDecision.create(
      [{ orgId: ctx.orgId, gstin, period, rowKey, documentNumber: row.portal.billNumber, supplierName: row.portal.supplierName, matchStatus: 'MISSING_IN_BOOKS', eligible: zero, notEligible, reason: reason.trim(), decidedBy: ctx.userId, decidedByName: ctx.userName }],
      { session }
    );
    await logActivity(ctx, { action: 'billing.gst_itc_decided', summary: `Decided not to claim GSTR-2B row ${row.portal.billNumber} from ${row.portal.supplierName}: ${reason.trim()}`, after: { decisionId: decision._id } }, session);
    return { decisionId: decision._id };
  });
}
