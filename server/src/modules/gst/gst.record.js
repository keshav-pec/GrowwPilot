// What owners read from the tax record: the overview and the sales register.
import { Branch, CustomerAdvance, GstCheck, GstPurchaseBill, GstRegistration, GstTaxEntry, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { oid, scoped } from '../../utils/scoped.js';
import { DateTime } from 'luxon';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { runOnce } from '../../middleware/idempotency.js';
import { gstSetupActive } from './gst.billing.js';
import { runTaxCheck } from './gst.check.js';
import { setupStateFor } from './gst.service.js';

const PAGE_SIZE = 25;
const TYPE_WORDS = {
  BILL_ISSUED: 'Bill',
  CREDIT_NOTE: 'Credit note',
  BILL_VOIDED: 'Voided bill',
  ADVANCE_RECEIVED: 'Advance taken',
  ADVANCE_USED: 'Advance used',
  ADVANCE_REFUNDED: 'Advance given back',
  ADVANCE_REVERSED: 'Advance reversed',
};

// The business owner sees everything. A branch owner sees their own branches only if the business owner switched it on.
function assertCanView(ctx, settings) {
  if (ctx.isPrimaryOwner) return;
  if (ctx.role !== 'OWNER' || !settings.branchOwners?.viewGst) throw new AppError(403, 'FORBIDDEN', 'The business owner hasn’t given you access to GST');
}

const myBranches = (ctx) => ({ branchId: { $in: ctx.allowedBranchIds.map(oid) } });

async function thisMonth(ctx) {
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').lean();
  return todayInZone(branch?.timezone ?? 'Asia/Kolkata').slice(0, 7);
}

// The filter for a month, one GSTIN or all of them, one kind of entry, and a search
function entryFilter(ctx, { month, gstin, type, search }) {
  const filter = scoped(ctx, { ...myBranches(ctx), period: month });
  if (gstin) filter.gstin = gstin;
  if (type) filter.type = type;
  if (search?.trim()) {
    const words = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ documentNumber: new RegExp(words, 'i') }, { customerName: new RegExp(words, 'i') }, { 'buyer.gstin': new RegExp(words, 'i') }];
  }
  return filter;
}

const totalsPipeline = (filter, by) => [
  { $match: { ...filter, orgId: oid(filter.orgId) } },
  { $group: { _id: by, count: { $sum: 1 }, taxable: { $sum: '$taxable' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, tax: { $sum: '$tax' }, total: { $sum: '$total' } } },
];
const NO_TOTALS = { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };

// Money collected in a month, at these branches: received less handed back. Its own measure, never the same as tax.
async function moneyCollected(ctx, month, gstin, registrations) {
  const inMonth = (link) => link.from.slice(0, 7) <= month && (!link.to || link.to.slice(0, 7) >= month);
  const linked = gstin ? registrations.filter((r) => r.gstin === gstin).flatMap((r) => r.branches.filter(inMonth).map((l) => String(l.branchId))) : null;
  const ids = ctx.allowedBranchIds.filter((id) => !linked || linked.includes(id));
  if (ids.length === 0) return 0;
  const branches = await Branch.find(scoped(ctx, { _id: { $in: ids } })).select('timezone').lean();
  const last = DateTime.fromISO(`${month}-01`).endOf('month').toISODate();
  const ranges = branches.map((b) => ({ branchId: b._id, receivedAt: { $gte: dayRangeUTC(`${month}-01`, b.timezone).start, $lt: dayRangeUTC(last, b.timezone).end } }));
  const rows = await Payment.aggregate([{ $match: { orgId: oid(ctx.orgId), status: 'VALID', $or: ranges } }, { $group: { _id: null, amount: { $sum: { $cond: [{ $eq: ['$kind', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }]);
  return rows[0]?.amount ?? 0;
}

// The small first screen: one period, its output tax, and what needs attention
export async function overview(ctx, { month, gstin }) {
  const settings = await getBillingSettings(ctx);
  assertCanView(ctx, settings);
  const period = month ?? (await thisMonth(ctx));
  const rows = await GstTaxEntry.aggregate(totalsPipeline(entryFilter(ctx, { month: period, gstin }), '$type'));
  const byType = Object.fromEntries(rows.map((r) => [r._id, r]));
  const net = rows.reduce((sum, r) => Object.fromEntries(Object.keys(NO_TOTALS).map((k) => [k, sum[k] + r[k]])), NO_TOTALS);

  const registrations = await GstRegistration.find(scoped(ctx)).sort({ from: -1 }).lean();
  const mine = registrations.filter((r) => ctx.isPrimaryOwner || r.branches.some((link) => ctx.allowedBranchIds.includes(String(link.branchId))));
  const gstins = [...new Map(mine.map((r) => [r.gstin, { gstin: r.gstin, legalName: r.legalName }])).values()];

  const check = await GstCheck.findOne(scoped(ctx)).lean();
  const differences = (check?.differences ?? []).filter((d) => ctx.isPrimaryOwner || !d.branchId || ctx.allowedBranchIds.includes(String(d.branchId)));
  const { problems } = gstSetupActive(settings) ? await setupStateFor(ctx, settings) : { problems: [] };

  return {
    active: gstSetupActive(settings),
    startMonth: settings.gst?.startMonth ?? null,
    month: period,
    gstins,
    net,
    bills: byType.BILL_ISSUED ?? NO_TOTALS,
    creditNotes: byType.CREDIT_NOTE ?? NO_TOTALS,
    voided: byType.BILL_VOIDED ?? NO_TOTALS,
    advanceTaken: byType.ADVANCE_RECEIVED ?? NO_TOTALS,
    advanceUsed: byType.ADVANCE_USED ?? NO_TOTALS,
    collected: await moneyCollected(ctx, period, gstin, registrations),
    purchasesToDecide: await GstPurchaseBill.countDocuments(scoped(ctx, { period, gstin: gstin ?? { $in: gstins.map((g) => g.gstin) }, 'cancelled.at': null, decisionId: null })),
    check: { ranAt: check?.ranAt ?? null, checked: check?.checked ?? 0, differences },
    setupProblems: problems,
    canRunCheck: Boolean(ctx.isPrimaryOwner),
  };
}

const presentRow = (e, branches) => ({
  _id: e._id,
  invoiceId: e.invoiceId,
  // Where the row opens: its bill, or the receipt voucher of an advance that isn't on a bill
  link: e.invoiceId ? `/app/invoices/${e.invoiceId}` : `/app/advances/${e.advanceId}`,
  taxDate: e.taxDate,
  type: TYPE_WORDS[e.type],
  documentNumber: e.documentNumber,
  invoiceNumber: e.invoiceNumber,
  branch: branches.get(String(e.branchId)),
  customer: e.customerName ?? 'Guest',
  buyerGstin: e.buyer?.gstin ?? '',
  gstin: e.gstin,
  place: e.placeOfSupply?.stateName ?? '',
  taxable: e.taxable,
  cgst: e.cgst,
  sgst: e.sgst,
  igst: e.igst,
  total: e.total,
});

const COLUMNS = [
  { key: 'taxDate', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'documentNumber', label: 'Number' },
  { key: 'branch', label: 'Branch' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'customer', label: 'Customer' },
  { key: 'buyerGstin', label: 'Customer GSTIN' },
  { key: 'place', label: 'Place of supply' },
  { key: 'taxable', label: 'Taxable', money: true },
  { key: 'cgst', label: 'CGST', money: true },
  { key: 'sgst', label: 'SGST', money: true },
  { key: 'igst', label: 'IGST', money: true },
  { key: 'total', label: 'Total', money: true },
];

// The sales register: every entry of a month, newest first. csv: all of them, for an accountant.
export async function salesRegister(ctx, { month, gstin, type, search, page = 1, all = false }) {
  const settings = await getBillingSettings(ctx);
  assertCanView(ctx, settings);
  const period = month ?? (await thisMonth(ctx));
  const filter = entryFilter(ctx, { month: period, gstin, type, search });
  const query = GstTaxEntry.find(filter).sort({ taxDate: -1, createdAt: -1, _id: -1 });
  if (!all) query.skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
  const [entries, count, totals, branchRows] = await Promise.all([query.lean(), GstTaxEntry.countDocuments(filter), GstTaxEntry.aggregate(totalsPipeline(filter, null)), Branch.find(scoped(ctx)).select('name').lean()]);
  const branches = new Map(branchRows.map((b) => [String(b._id), b.name]));
  return { month: period, columns: COLUMNS, rows: entries.map((e) => presentRow(e, branches)), totals: totals[0] ?? NO_TOTALS, page, pages: Math.max(Math.ceil(count / PAGE_SIZE), 1), total: count };
}

const ADVANCE_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'receiptNumber', label: 'Receipt voucher' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'branch', label: 'Branch' },
  { key: 'customer', label: 'Customer' },
  { key: 'services', label: 'For' },
  { key: 'taken', label: 'Taken', money: true },
  { key: 'used', label: 'Used', money: true },
  { key: 'givenBack', label: 'Given back', money: true },
  { key: 'left', label: 'Left', money: true },
  { key: 'taxTaken', label: 'Tax paid', money: true },
  { key: 'taxUsed', label: 'Tax used or given back', money: true },
  { key: 'taxLeft', label: 'Tax left', money: true },
];

// Advances for named services: taken, used and left, with their tax, for each GSTIN. Plain advances aren't taxed, so they
// only show as one figure. gstin: one of them; open: only those with money left.
export async function advancesView(ctx, { gstin, open = false }) {
  const settings = await getBillingSettings(ctx);
  assertCanView(ctx, settings);
  const mine = { branchId: { $in: ctx.allowedBranchIds.map(oid) } };
  const filter = scoped(ctx, { ...mine, taxed: true, ...(gstin ? { 'gst.gstin': gstin } : {}), ...(open ? { remaining: { $gt: 0 } } : {}) });
  const [advances, branchRows, plain] = await Promise.all([
    CustomerAdvance.find(filter).sort({ createdAt: -1 }).lean(),
    Branch.find(scoped(ctx)).select('name').lean(),
    CustomerAdvance.aggregate([{ $match: { orgId: oid(ctx.orgId), ...mine, taxed: { $ne: true } } }, { $group: { _id: null, left: { $sum: '$remaining' } } }]),
  ]);
  const used = await PaymentAllocation.aggregate([{ $match: { advanceId: { $in: advances.map((a) => a._id) }, status: 'VALID' } }, { $group: { _id: '$advanceId', amount: { $sum: '$amount' } } }]);
  const branches = new Map(branchRows.map((b) => [String(b._id), b.name]));
  const rows = advances.map((a) => {
    const g = a.gst;
    const taxTaken = g.cgst + g.sgst + g.igst;
    const taxLeft = g.leftCgst + g.leftSgst + g.leftIgst;
    return {
      _id: a._id,
      link: `/app/advances/${a._id}`,
      date: g.taxDate,
      receiptNumber: a.receiptNumber,
      gstin: g.gstin,
      branch: branches.get(String(a.branchId)),
      customer: g.customerName,
      services: a.forServices.map((f) => f.name).join(', '),
      reversed: Boolean(a.reversedAt),
      taken: a.amount,
      used: used.find((u) => String(u._id) === String(a._id))?.amount ?? 0,
      givenBack: a.givenBack,
      left: a.remaining,
      taxTaken,
      taxUsed: taxTaken - taxLeft,
      taxLeft,
    };
  });
  const sum = (list, key) => list.reduce((total, r) => total + r[key], 0);
  const KEYS = ['taken', 'used', 'givenBack', 'left', 'taxTaken', 'taxUsed', 'taxLeft'];
  const totalsOf = (list) => Object.fromEntries(KEYS.map((key) => [key, sum(list, key)]));
  const byGstin = [...new Set(rows.map((r) => r.gstin))].map((id) => ({ gstin: id, ...totalsOf(rows.filter((r) => r.gstin === id)) }));
  return { columns: ADVANCE_COLUMNS, rows, totals: totalsOf(rows), byGstin, plainLeft: plain[0]?.left ?? 0 };
}

// The business owner runs the same check as the night timer
export async function checkNow(ctx, key) {
  if (!ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can run the check');
  return runOnce(ctx, { key, operation: 'gst.check' }, async () => {
    const result = await runTaxCheck(oid(ctx.orgId));
    if (!result) throw new AppError(409, 'GST_NOT_ACTIVE', 'Activate GST setup first');
    return { checked: result.checked, differences: result.differences.length };
  });
}
