import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Branch, CommissionEntry, Customer, CustomerAdvance, Invoice, Payment, PaymentAllocation, Refund } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { billingPermissions, getBillingSettings } from './settings.service.js';
import { advancesOf } from '../payments/allocations.js';
import { cashDaysBetween } from '../cash/cash.service.js';

// ---------------------------------------------------------------------------
// Billing reports (BILLING_PLAN.md, Phase 3). Each one is a plain table { title, note, columns, rows },
// shown on screen and downloadable as CSV. Dates are read in each branch's own timezone.
//   Owners: every report, for the selected branch or all their branches.
//   Front desk: only today's collections at their branch.
// The words used:
//   gross      = list prices x qty (before any discount)
//   net sales  = what was sold after discounts, without GST, less what refunds took back
//   collected  = money received (payments and advances) less money handed back
// ---------------------------------------------------------------------------

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const localDay = (date, zone) => DateTime.fromJSDate(date, { zone }).toISODate();
const METHOD_WORDS = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' };
const BUCKETS = [
  { label: '0–30 days', max: 30 },
  { label: '31–60 days', max: 60 },
  { label: '61–90 days', max: 90 },
  { label: 'Over 90 days', max: Infinity },
];

// { $or: [{ branchId: A, <field>: A's range }, ...] } — "1 Oct" is 1 Oct in each branch's own time
function inRange(branches, field, from, to) {
  return { $or: branches.map((b) => ({ branchId: b._id, [field]: { $gte: dayRangeUTC(from, b.timezone).start, $lt: dayRangeUTC(to, b.timezone).end } })) };
}
const zoneOf = (branches, id) => branches.find((b) => String(b._id) === String(id)).timezone;
const nameOf = (branches, id) => branches.find((b) => String(b._id) === String(id))?.name;
const add = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};

// Issued bills and done refunds in a period (both are used by several reports)
const billsIn = (ctx, branches, from, to) => Invoice.find({ orgId: oid(ctx.orgId), status: 'ISSUED', ...inRange(branches, 'issuedAt', from, to) }).populate('issuedBy', 'name').lean();
const refundsIn = (ctx, branches, from, to) => Refund.find({ orgId: oid(ctx.orgId), status: 'DONE', ...inRange(branches, 'decidedAt', from, to) }).lean();

// ---- the reports ------------------------------------------------------------

// Sales by day: bills issued and refunds done, gross to net
async function sales(ctx, { branches, from, to }) {
  const [bills, refunds] = await Promise.all([billsIn(ctx, branches, from, to), refundsIn(ctx, branches, from, to)]);
  const rows = new Map();
  const rowFor = (branchId, day) =>
    add(rows, `${day}|${branchId}`, () => ({ day, branch: nameOf(branches, branchId), bills: 0, gross: 0, discounts: 0, taxable: 0, gst: 0, billed: 0, refundedTaxable: 0, refundedGst: 0 }));
  for (const b of bills) {
    const r = rowFor(b.branchId, localDay(b.issuedAt, zoneOf(branches, b.branchId)));
    r.bills += 1;
    r.gross += b.subtotal;
    r.discounts += b.discountTotal;
    r.taxable += b.taxableTotal;
    r.gst += b.taxTotal;
    r.billed += b.grandTotal;
  }
  for (const refund of refunds) {
    const r = rowFor(refund.branchId, localDay(refund.decidedAt, zoneOf(branches, refund.branchId)));
    for (const l of refund.lines) {
      r.refundedTaxable += l.taxableAmount;
      r.refundedGst += l.cgst + l.sgst;
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, netSales: r.taxable - r.refundedTaxable, netGst: r.gst - r.refundedGst })).sort((a, b) => a.day.localeCompare(b.day) || a.branch.localeCompare(b.branch));
  return {
    title: 'Sales by day',
    note: 'Gross = list prices. Net sales = after discounts and refunds, without GST. Refunds count on the day they were done.',
    columns: [
      { key: 'day', label: 'Day' },
      { key: 'branch', label: 'Branch' },
      { key: 'bills', label: 'Bills' },
      { key: 'gross', label: 'Gross', money: true },
      { key: 'discounts', label: 'Discounts', money: true },
      { key: 'taxable', label: 'Sales before refunds', money: true },
      { key: 'refundedTaxable', label: 'Refunded', money: true },
      { key: 'netSales', label: 'Net sales', money: true },
      { key: 'netGst', label: 'GST (net)', money: true },
      { key: 'billed', label: 'Billed incl. GST', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['bills', 'gross', 'discounts', 'taxable', 'refundedTaxable', 'netSales', 'netGst', 'billed']),
  };
}

// GST collected by rate: bills minus credit notes (for the GST return; a tax adviser should check it)
async function gst(ctx, { branches, from, to }) {
  const [bills, refunds] = await Promise.all([billsIn(ctx, branches, from, to), refundsIn(ctx, branches, from, to)]);
  const rows = new Map();
  const rowFor = (rateBps) => add(rows, rateBps, () => ({ rate: `${rateBps / 100}%`, rateBps, taxable: 0, cgst: 0, sgst: 0, creditTaxable: 0, creditCgst: 0, creditSgst: 0 }));
  for (const b of bills.filter((x) => x.gstRegistered)) {
    for (const t of b.taxSummary ?? []) {
      const r = rowFor(t.rateBps);
      r.taxable += t.taxableAmount;
      r.cgst += t.cgst;
      r.sgst += t.sgst;
    }
  }
  for (const refund of refunds) {
    for (const l of refund.lines.filter((x) => x.taxRateBps > 0)) {
      const r = rowFor(l.taxRateBps);
      r.creditTaxable += l.taxableAmount;
      r.creditCgst += l.cgst;
      r.creditSgst += l.sgst;
    }
  }
  const list = [...rows.values()]
    .sort((a, b) => a.rateBps - b.rateBps)
    .map((r) => ({ ...r, netTaxable: r.taxable - r.creditTaxable, netCgst: r.cgst - r.creditCgst, netSgst: r.sgst - r.creditSgst }));
  return {
    title: 'GST collected',
    note: 'Bills issued in the period, less credit notes made in the period. Please have your tax adviser check before filing.',
    columns: [
      { key: 'rate', label: 'GST rate' },
      { key: 'taxable', label: 'Taxable (bills)', money: true },
      { key: 'cgst', label: 'CGST (bills)', money: true },
      { key: 'sgst', label: 'SGST (bills)', money: true },
      { key: 'creditTaxable', label: 'Taxable (credit notes)', money: true },
      { key: 'creditCgst', label: 'CGST (credit notes)', money: true },
      { key: 'creditSgst', label: 'SGST (credit notes)', money: true },
      { key: 'netTaxable', label: 'Net taxable', money: true },
      { key: 'netCgst', label: 'Net CGST', money: true },
      { key: 'netSgst', label: 'Net SGST', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['taxable', 'cgst', 'sgst', 'creditTaxable', 'creditCgst', 'creditSgst', 'netTaxable', 'netCgst', 'netSgst']),
  };
}

// Discounts by the person who issued the bill, and by service or product (combo prices are not discounts here)
async function discounts(ctx, { branches, from, to }) {
  const bills = await billsIn(ctx, branches, from, to);
  const rows = new Map();
  for (const b of bills) {
    for (const l of b.lines) {
      const amount = l.lineDiscount + l.billDiscountShare;
      if (amount <= 0) continue;
      const by = b.issuedBy?.name ?? 'Unknown';
      const r = add(rows, `${by}|${l.name}`, () => ({ person: by, item: l.name, kind: l.kind === 'PRODUCT' ? 'Product' : 'Service', lines: 0, approved: 0, discount: 0 }));
      r.lines += 1;
      r.discount += amount;
      if (b.approval?.status === 'APPROVED') r.approved += 1;
    }
  }
  const list = [...rows.values()].sort((a, b) => b.discount - a.discount);
  return {
    title: 'Discounts given',
    note: 'Discounts on lines and on whole bills (shared over the lines), by who issued the bill. Approved = above the front desk limit, approved by an owner.',
    columns: [
      { key: 'person', label: 'Issued by' },
      { key: 'item', label: 'Service or product' },
      { key: 'kind', label: 'Kind' },
      { key: 'lines', label: 'Times' },
      { key: 'approved', label: 'Approved by owner' },
      { key: 'discount', label: 'Discount', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['lines', 'approved', 'discount']),
  };
}

// Collections by day and method: money received (bills and advances) and money handed back
async function collections(ctx, { branches, from, to }) {
  const payments = await Payment.find({ orgId: oid(ctx.orgId), status: 'VALID', ...inRange(branches, 'receivedAt', from, to) }).lean();
  const rows = new Map();
  for (const p of payments) {
    const day = localDay(p.receivedAt, zoneOf(branches, p.branchId));
    const r = add(rows, `${day}|${p.branchId}|${p.method}`, () => ({ day, branch: nameOf(branches, p.branchId), method: METHOD_WORDS[p.method], payments: 0, received: 0, advances: 0, refunded: 0 }));
    if (p.kind === 'REFUND') {
      r.refunded += p.amount;
    } else {
      r.payments += 1;
      r.received += p.amount;
      if (p.source === 'ADVANCE') r.advances += p.amount;
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, net: r.received - r.refunded })).sort((a, b) => a.day.localeCompare(b.day) || a.branch.localeCompare(b.branch) || a.method.localeCompare(b.method));
  return {
    title: 'Collections',
    note: 'Money received (bill payments and advances taken) less money handed back by refunds. Reversed payments are left out.',
    columns: [
      { key: 'day', label: 'Day' },
      { key: 'branch', label: 'Branch' },
      { key: 'method', label: 'Method' },
      { key: 'payments', label: 'Payments' },
      { key: 'received', label: 'Received', money: true },
      { key: 'advances', label: 'Of which advances', money: true },
      { key: 'refunded', label: 'Handed back', money: true },
      { key: 'net', label: 'Net collected', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['payments', 'received', 'advances', 'refunded', 'net']),
  };
}

// Bills with money still due, oldest first, with their age (dates don't apply: it's as of today)
async function dues(ctx, { branches }) {
  const bills = await Invoice.find(scoped(ctx, { branchId: { $in: branches.map((b) => b._id) }, status: 'ISSUED', balanceDue: { $gt: 0 } })).sort({ issuedAt: 1 }).lean();
  const list = bills.map((b) => {
    const zone = zoneOf(branches, b.branchId);
    const age = Math.max(Math.floor(DateTime.fromISO(todayInZone(zone)).diff(DateTime.fromISO(localDay(b.issuedAt, zone)), 'days').days), 0);
    return {
      _id: b._id,
      customerId: b.customerId,
      invoiceNumber: b.invoiceNumber,
      day: localDay(b.issuedAt, zone),
      branch: nameOf(branches, b.branchId),
      customer: b.customerSnapshot?.name ?? 'Guest',
      phone: b.customerSnapshot?.phone ?? '',
      billed: b.grandTotal - (b.creditedTotal ?? 0),
      paid: b.amountPaid - (b.refundedTotal ?? 0),
      due: b.balanceDue,
      age,
      bucket: BUCKETS.find((x) => age <= x.max).label,
    };
  });
  return {
    title: 'Dues',
    note: 'Bills with money still owed, as of today. Age = days since the bill was issued.',
    columns: [
      { key: 'invoiceNumber', label: 'Bill' },
      { key: 'day', label: 'Issued' },
      { key: 'branch', label: 'Branch' },
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'billed', label: 'Bill', money: true },
      { key: 'paid', label: 'Paid', money: true },
      { key: 'due', label: 'Due', money: true },
      { key: 'age', label: 'Age (days)' },
      { key: 'bucket', label: 'Age group' },
    ],
    rows: list,
    totals: totalsOf(list, ['billed', 'paid', 'due']),
  };
}

// Advances per customer: taken and used in the period, and what's left now
async function advances(ctx, { branches, from, to }) {
  const taken = await CustomerAdvance.find({ orgId: oid(ctx.orgId), ...inRange(branches, 'createdAt', from, to) }).lean();
  const used = await PaymentAllocation.find({ orgId: oid(ctx.orgId), advanceId: { $ne: null }, status: 'VALID', ...inRange(branches, 'createdAt', from, to) }).populate('advanceId', 'customerId').lean();
  const rows = new Map();
  const rowFor = (customerId) => add(rows, String(customerId), () => ({ customerId, taken: 0, used: 0 }));
  for (const a of taken) rowFor(a.customerId).taken += a.amount;
  for (const u of used) if (u.advanceId) rowFor(u.advanceId.customerId).used += u.amount;
  const customers = await Customer.find(scoped(ctx, { _id: { $in: [...rows.keys()] } })).select('name phone').lean();
  const list = [];
  for (const r of rows.values()) {
    const customer = customers.find((c) => String(c._id) === String(r.customerId));
    list.push({ customer: customer?.name ?? '?', phone: customer?.phone ?? '', taken: r.taken, used: r.used, balance: (await advancesOf(ctx, r.customerId)).balance });
  }
  list.sort((a, b) => b.balance - a.balance || a.customer.localeCompare(b.customer));
  return {
    title: 'Customer advances',
    note: 'Advances taken and used in the period (at these branches), and what each customer has left now (usable at any branch).',
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'taken', label: 'Taken', money: true },
      { key: 'used', label: 'Used', money: true },
      { key: 'balance', label: 'Left now', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['taken', 'used']),
  };
}

// Retail: products sold, returned and net, with their sales and GST
async function retail(ctx, { branches, from, to }) {
  const [bills, refunds] = await Promise.all([billsIn(ctx, branches, from, to), refundsIn(ctx, branches, from, to)]);
  const rows = new Map();
  const rowFor = (name) => add(rows, name, () => ({ product: name, sold: 0, returned: 0, sales: 0, returnedValue: 0, gst: 0 }));
  for (const b of bills) {
    for (const l of b.lines.filter((x) => x.kind === 'PRODUCT')) {
      const r = rowFor(l.name);
      r.sold += l.qty;
      r.sales += l.taxableAmount;
      r.gst += l.cgst + l.sgst;
    }
  }
  for (const refund of refunds) {
    for (const l of refund.lines.filter((x) => x.kind === 'PRODUCT')) {
      const r = rowFor(l.name);
      r.returned += l.qty;
      r.returnedValue += l.taxableAmount;
      r.gst -= l.cgst + l.sgst;
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, netQty: r.sold - r.returned, netSales: r.sales - r.returnedValue })).sort((a, b) => b.netSales - a.netSales);
  return {
    title: 'Retail sales',
    note: 'Products sold on bills in the period, less those brought back in the period. Sales are without GST.',
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'sold', label: 'Sold' },
      { key: 'returned', label: 'Returned' },
      { key: 'netQty', label: 'Net' },
      { key: 'sales', label: 'Sales', money: true },
      { key: 'returnedValue', label: 'Returned value', money: true },
      { key: 'netSales', label: 'Net sales', money: true },
      { key: 'gst', label: 'GST (net)', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['sold', 'returned', 'netQty', 'sales', 'returnedValue', 'netSales', 'gst']),
  };
}

// Cash closing: each cash day with its figures
async function cash(ctx, { branches, from, to }) {
  const days = await cashDaysBetween(ctx, { branches, from, to });
  const list = days.map((d) => ({
    day: d.day,
    branch: nameOf(branches, d.branchId),
    status: d.status === 'OPEN' ? 'Open' : 'Closed',
    openingFloat: d.openingFloat,
    cashIn: d.cashIn,
    cashOut: d.cashOut,
    petty: d.pettyIn - d.pettyOut,
    expected: d.expectedCash,
    counted: d.countedCash ?? null,
    difference: d.difference ?? null,
    adjustments: d.adjustments ?? 0,
    closedBy: d.closedByName ?? '',
    note: d.closeNote ?? '',
  }));
  return {
    title: 'Cash closing',
    note: 'Expected = float + cash received - cash handed back + petty cash. Difference = counted - expected (minus = short).',
    columns: [
      { key: 'day', label: 'Day' },
      { key: 'branch', label: 'Branch' },
      { key: 'status', label: 'Status' },
      { key: 'openingFloat', label: 'Float', money: true },
      { key: 'cashIn', label: 'Cash in', money: true },
      { key: 'cashOut', label: 'Cash out', money: true },
      { key: 'petty', label: 'Petty cash', money: true },
      { key: 'expected', label: 'Expected', money: true },
      { key: 'counted', label: 'Counted', money: true },
      { key: 'difference', label: 'Difference', money: true },
      { key: 'adjustments', label: 'Adjustments', money: true },
      { key: 'closedBy', label: 'Closed by' },
      { key: 'note', label: 'Note' },
    ],
    rows: list,
    totals: totalsOf(list, ['cashIn', 'cashOut', 'petty', 'difference', 'adjustments']),
  };
}

// Sales by staff: services done on bills issued in the period, net of refunds, and their commission
async function staff(ctx, { branches, from, to }) {
  const [bills, refunds] = await Promise.all([billsIn(ctx, branches, from, to), refundsIn(ctx, branches, from, to)]);
  const commission = await CommissionEntry.find(scoped(ctx, { branchId: { $in: branches.map((b) => b._id) }, day: { $gte: from, $lte: to } })).select('staffId amount').lean();
  const rows = new Map();
  const rowFor = (id, name) => add(rows, String(id), () => ({ staffId: id, person: name, services: 0, sales: 0, refunded: 0, commission: 0 }));
  const lineOwner = new Map();
  for (const b of bills) {
    for (const l of b.lines.filter((x) => x.kind === 'SERVICE' && x.staffId)) {
      const r = rowFor(l.staffId, l.staffName);
      r.services += 1;
      r.sales += l.taxableAmount;
    }
  }
  // A refunded service counts against whoever did it, on the day of the refund
  const refundedBills = await Invoice.find({ _id: { $in: refunds.map((r) => r.invoiceId) } }).select('lines._id lines.staffId lines.staffName').lean();
  for (const bill of refundedBills) for (const l of bill.lines) lineOwner.set(String(l._id), l);
  for (const refund of refunds) {
    for (const l of refund.lines.filter((x) => x.kind === 'SERVICE')) {
      const owner = lineOwner.get(String(l.lineId));
      if (owner?.staffId) rowFor(owner.staffId, owner.staffName).refunded += l.taxableAmount;
    }
  }
  for (const c of commission) {
    const r = rows.get(String(c.staffId));
    if (r) r.commission += c.amount;
  }
  const list = [...rows.values()].map((r) => ({ ...r, netSales: r.sales - r.refunded })).sort((a, b) => b.netSales - a.netSales);
  return {
    title: 'Sales by staff',
    note: 'Services on bills issued in the period (after discounts, without GST), less refunds done in the period. Commission is what was earned (less reversals) on days in the period.',
    columns: [
      { key: 'person', label: 'Staff' },
      { key: 'services', label: 'Services' },
      { key: 'sales', label: 'Sales', money: true },
      { key: 'refunded', label: 'Refunded', money: true },
      { key: 'netSales', label: 'Net sales', money: true },
      { key: 'commission', label: 'Commission', money: true },
    ],
    rows: list,
    totals: totalsOf(list, ['services', 'sales', 'refunded', 'netSales', 'commission']),
  };
}

function totalsOf(rows, keys) {
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((sum, r) => sum + (r[k] ?? 0), 0)]));
}

export const REPORTS = {
  sales: { label: 'Sales by day', build: sales },
  gst: { label: 'GST collected', build: gst },
  discounts: { label: 'Discounts given', build: discounts },
  collections: { label: 'Collections', build: collections },
  dues: { label: 'Dues', build: dues },
  advances: { label: 'Customer advances', build: advances },
  retail: { label: 'Retail sales', build: retail },
  cash: { label: 'Cash closing', build: cash },
  staff: { label: 'Sales by staff', build: staff },
};

// Runs one report. branches: 'current' (the selected branch) or 'all' (every branch I may see).
// The front desk only gets today's collections at their branch, whatever they ask for
// (and the Dues page, which shows their branch's dues: deskMay).
export async function runReport(ctx, name, { from, to, branches = 'current' }, { deskMay = ['collections'] } = {}) {
  const report = REPORTS[name];
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found');
  const settings = await getBillingSettings(ctx);
  const owner = billingPermissions(ctx, settings).viewReports;
  if (!owner && !deskMay.includes(name)) throw new AppError(403, 'FORBIDDEN', 'The front desk can see today’s collections only');

  const ids = owner && branches === 'all' ? ctx.allowedBranchIds : [ctx.activeBranchId];
  const branchDocs = await Branch.find(scoped(ctx, { _id: { $in: ids } })).select('name timezone').sort({ name: 1 }).lean();
  const zone = branchDocs.find((b) => String(b._id) === String(ctx.activeBranchId))?.timezone ?? branchDocs[0].timezone;
  const today = todayInZone(zone);
  let toDate = to ?? today;
  let fromDate = from ?? DateTime.fromISO(toDate).minus({ days: 29 }).toISODate();
  if (!owner) fromDate = toDate = today;
  if (fromDate > toDate) throw new AppError(400, 'VALIDATION_ERROR', 'The start date is after the end date');

  const result = await report.build(ctx, { branches: branchDocs, from: fromDate, to: toDate });
  return { name, ...result, from: fromDate, to: toDate, branches: branchDocs.map((b) => b.name) };
}

// The Dues page: the dues report, plus totals per age group and per customer
export async function duesOverview(ctx, { branches = 'current', search }) {
  const report = await runReport(ctx, 'dues', { branches }, { deskMay: ['dues'] });
  let rows = report.rows;
  if (search) {
    const text = search.trim().toLowerCase();
    const digits = text.replace(/\D/g, '');
    rows = rows.filter((r) => r.customer.toLowerCase().includes(text) || r.invoiceNumber.toLowerCase().includes(text) || (digits.length >= 3 && r.phone.includes(digits)));
  }
  const buckets = BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.bucket === b.label);
    return { label: b.label, bills: inBucket.length, due: inBucket.reduce((sum, r) => sum + r.due, 0) };
  });
  const customers = new Map();
  for (const r of rows) {
    const c = add(customers, String(r.customerId ?? r.customer), () => ({ customerId: r.customerId, customer: r.customer, phone: r.phone, bills: 0, due: 0, oldest: 0 }));
    c.bills += 1;
    c.due += r.due;
    c.oldest = Math.max(c.oldest, r.age);
  }
  return {
    asOf: report.to,
    total: rows.reduce((sum, r) => sum + r.due, 0),
    buckets,
    customers: [...customers.values()].sort((a, b) => b.due - a.due),
    rows,
  };
}

// ---------------------------------------------------------------------------
// A customer's money with the salon (customer profile): bills, payments, refunds, advance and what they owe.
// Bills at branches I can't use are left out.
// ---------------------------------------------------------------------------
export async function customerMoney(ctx, customerId) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('_id').lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const mine = { branchId: { $in: ctx.allowedBranchIds.map(oid) } };
  const bills = await Invoice.find(scoped(ctx, { customerId, status: { $in: ['ISSUED', 'VOID'] }, ...mine }))
    .select('invoiceNumber status settlementStatus refundStatus grandTotal creditedTotal amountPaid refundedTotal balanceDue issuedAt branchId')
    .populate('branchId', 'name timezone')
    .sort({ issuedAt: -1 })
    .limit(100)
    .lean();
  const payments = await Payment.find(scoped(ctx, { customerId, ...mine })).sort({ receivedAt: -1 }).limit(100).populate('branchId', 'name').lean();
  const refunds = await Refund.find(scoped(ctx, { customerId, ...mine })).sort({ createdAt: -1 }).limit(50).lean();
  const issued = bills.filter((b) => b.status === 'ISSUED');
  return {
    totalDue: issued.reduce((sum, b) => sum + b.balanceDue, 0),
    totalBilled: issued.reduce((sum, b) => sum + b.grandTotal - (b.creditedTotal ?? 0), 0),
    advanceBalance: (await advancesOf(ctx, customerId)).balance,
    bills,
    payments: payments.map((p) => ({ _id: p._id, kind: p.kind, method: p.method, amount: p.amount, source: p.source, status: p.status, reference: p.reference, receivedAt: p.receivedAt, branch: p.branchId?.name })),
    refunds: refunds.map((r) => ({ _id: r._id, status: r.status, invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, creditTotal: r.creditTotal, cashRefund: r.cashRefund, creditNoteNumber: r.creditNoteNumber, reason: r.reason, createdAt: r.createdAt })),
  };
}

// ---------------------------------------------------------------------------
// Net sales and collections between two moments at some branches (dashboard and analytics).
// net sales = bills' taxable value (after discounts, without GST) - what refunds took back
// collected = money received - money handed back
// -> { [branchId]: { netSales, bills, collected } }
// ---------------------------------------------------------------------------
export async function moneyByBranch(orgId, ranges) {
  const org = oid(orgId);
  const match = (field) => ({ $or: ranges.map((r) => ({ branchId: oid(r.branchId), [field]: { $gte: r.start, $lt: r.end } })) });
  const [bills, refunds, payments] = await Promise.all([
    Invoice.aggregate([{ $match: { orgId: org, status: 'ISSUED', ...match('issuedAt') } }, { $group: { _id: '$branchId', taxable: { $sum: '$taxableTotal' }, bills: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: { orgId: org, status: 'DONE', ...match('decidedAt') } }, { $unwind: '$lines' }, { $group: { _id: '$branchId', taxable: { $sum: '$lines.taxableAmount' } } }]),
    Payment.aggregate([
      { $match: { orgId: org, status: 'VALID', ...match('receivedAt') } },
      { $group: { _id: '$branchId', amount: { $sum: { $cond: [{ $eq: ['$kind', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
  ]);
  const result = {};
  for (const r of ranges) {
    const id = String(r.branchId);
    const find = (list) => list.find((x) => String(x._id) === id);
    result[id] = { netSales: (find(bills)?.taxable ?? 0) - (find(refunds)?.taxable ?? 0), bills: find(bills)?.bills ?? 0, collected: find(payments)?.amount ?? 0 };
  }
  return result;
}
