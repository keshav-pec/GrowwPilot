// What owners read from the tax record: the overview and the sales register.
import { Branch, GstCheck, GstRegistration, GstTaxEntry } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { oid, scoped } from '../../utils/scoped.js';
import { todayInZone } from '../../utils/time.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { runOnce } from '../../middleware/idempotency.js';
import { gstSetupActive } from './gst.billing.js';
import { runTaxCheck } from './gst.check.js';
import { setupStateFor } from './gst.service.js';

const PAGE_SIZE = 25;
const TYPE_WORDS = { BILL_ISSUED: 'Bill', CREDIT_NOTE: 'Credit note', BILL_VOIDED: 'Voided bill' };

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
    check: { ranAt: check?.ranAt ?? null, checked: check?.checked ?? 0, differences },
    setupProblems: problems,
    canRunCheck: Boolean(ctx.isPrimaryOwner),
  };
}

const presentRow = (e, branches) => ({
  _id: e._id,
  invoiceId: e.invoiceId,
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

// The business owner runs the same check as the night timer
export async function checkNow(ctx, key) {
  if (!ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can run the check');
  return runOnce(ctx, { key, operation: 'gst.check' }, async () => {
    const result = await runTaxCheck(oid(ctx.orgId));
    if (!result) throw new AppError(409, 'GST_NOT_ACTIVE', 'Activate GST setup first');
    return { checked: result.checked, differences: result.differences.length };
  });
}
