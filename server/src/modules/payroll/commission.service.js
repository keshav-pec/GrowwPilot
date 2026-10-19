import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Branch, CommissionEntry, CommissionRule, Invoice, PayPlan } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';
import { commissionAmount, pickRate } from './commission.rules.js';

// Commission is earned when a service is completed AND its bill is fully paid (a part-paid bill earns
// nothing yet). It's worked out on what the customer actually paid for each service: the bill line's
// taxable amount, i.e. after every discount and without GST (see billing/tax.rules.js).

// The pay setup of each person on one day: { staffId: plan }
async function plansOnDay(orgId, staffIds, day, session) {
  const plans = await PayPlan.find({
    orgId,
    staffId: { $in: staffIds },
    effectiveFrom: { $lte: day },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: day } }],
  })
    .session(session ?? null)
    .lean();
  return Object.fromEntries(plans.map((p) => [String(p.staffId), p]));
}

// Writes the commission lines for one fully paid bill, one per service line, on the day it became fully paid.
// A service that has earned (and not been reversed since) is skipped, so calling it again never pays twice.
// After a wrong payment was reversed and the bill is paid again, it earns again ("paid:2").
// Refunded services never earn again.
export async function recordInvoiceCommissions({ invoice, appointment, timezone }, session) {
  const day = DateTime.fromJSDate(invoice.paidAt, { zone: timezone }).toISODate();
  // Who did each service comes from the bill line (the appointment as a fallback)
  const lines = invoice.lines
    .filter((l) => l.kind === 'SERVICE' && l.itemId && !(l.refundedQty >= l.qty))
    .map((l) => {
      const item = appointment?.items.find((i) => String(i._id) === String(l.itemId));
      return { itemId: l.itemId, staffId: l.staffId ?? item?.staffId, serviceId: l.serviceId ?? item?.serviceId, serviceName: l.name, saleAmount: l.taxableAmount };
    })
    .filter((l) => l.staffId);
  if (lines.length === 0) return [];

  const staffIds = [...new Set(lines.map((l) => String(l.staffId)))];
  const [plans, rules, existing] = await Promise.all([
    plansOnDay(invoice.orgId, staffIds, day, session),
    CommissionRule.find({ orgId: invoice.orgId, staffId: { $in: staffIds }, serviceId: { $in: lines.map((l) => l.serviceId) } })
      .session(session ?? null)
      .lean(),
    CommissionEntry.find({ invoiceId: invoice._id }).select('itemId type').session(session ?? null).lean(),
  ]);
  const count = (line, type) => existing.filter((e) => String(e.itemId) === String(line.itemId) && e.type === type).length;

  const entries = [];
  for (const line of lines) {
    const earned = count(line, 'earned');
    if (earned > count(line, 'reversal')) continue; // already earning
    const rule = rules.find((r) => String(r.staffId) === String(line.staffId) && String(r.serviceId) === String(line.serviceId));
    const rate = pickRate(plans[String(line.staffId)], rule);
    if (!rate || rate.rateBps === 0) continue;
    entries.push({
      orgId: invoice.orgId,
      branchId: invoice.branchId,
      staffId: line.staffId,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId: invoice.appointmentId,
      itemId: line.itemId,
      serviceId: line.serviceId,
      serviceName: line.serviceName,
      day,
      saleAmount: line.saleAmount,
      ...rate,
      amount: commissionAmount(line.saleAmount, rate.rateBps),
      eventKey: `paid:${earned + 1}`,
    });
  }

  if (entries.length > 0) await CommissionEntry.insertMany(entries, { session });
  return entries;
}

// Takes back the commission still standing on some services of a bill (all of them if itemIds is left out):
// a refund, a payment that turned out to be wrong, or a voided bill. Adds 'reversal' rows with minus amounts
// on `day`; earned rows are never changed. eventKey says why, e.g. "refund:<id>" (one row per service per event).
export async function reverseCommissions({ invoice, itemIds, eventKey, day }, session) {
  const rows = await CommissionEntry.find({ invoiceId: invoice._id, ...(itemIds ? { itemId: { $in: itemIds } } : {}) }).session(session ?? null).lean();
  const byItem = new Map();
  for (const row of rows) {
    const key = String(row.itemId);
    const net = byItem.get(key) ?? { sale: 0, amount: 0, earned: 0, reversed: 0, last: row };
    net.sale += row.saleAmount;
    net.amount += row.amount;
    net[row.type === 'earned' ? 'earned' : 'reversed'] += 1;
    if (row.type === 'earned') net.last = row;
    byItem.set(key, net);
  }
  const reversals = [...byItem.values()]
    .filter((net) => net.earned > net.reversed) // still earning
    .map(({ sale, amount, last }) => ({
      orgId: last.orgId,
      branchId: last.branchId,
      staffId: last.staffId,
      invoiceId: last.invoiceId,
      invoiceNumber: invoice.invoiceNumber ?? last.invoiceNumber,
      appointmentId: last.appointmentId,
      itemId: last.itemId,
      serviceId: last.serviceId,
      serviceName: last.serviceName,
      day,
      saleAmount: -sale,
      rateBps: last.rateBps,
      rateSource: last.rateSource,
      ruleId: last.ruleId,
      amount: -amount,
      type: 'reversal',
      eventKey,
    }));
  if (reversals.length > 0) await CommissionEntry.insertMany(reversals, { session });
  return reversals;
}

// Bills that became fully paid between two branch-local days (inclusive), each with its appointment,
// branch timezone and paid day. staffId: only bills where that person did a service.
export async function paidBillsBetween(orgId, { from, to, staffId }) {
  // A day either side covers every timezone; the exact branch day is checked below
  const invoices = await Invoice.find({
    orgId,
    status: 'ISSUED',
    settlementStatus: 'PAID',
    appointmentId: { $type: 'objectId' },
    paidAt: { $gte: DateTime.fromISO(from).minus({ days: 1 }).toJSDate(), $lt: DateTime.fromISO(to).plus({ days: 2 }).toJSDate() },
  }).lean();
  if (invoices.length === 0) return [];

  const apptFilter = { orgId, _id: { $in: invoices.map((i) => i.appointmentId) } };
  if (staffId) apptFilter['items.staffId'] = staffId;
  const [appointments, branches] = await Promise.all([Appointment.find(apptFilter).lean(), Branch.find({ orgId }).select('timezone').lean()]);
  const zoneOf = Object.fromEntries(branches.map((b) => [String(b._id), b.timezone]));

  const bills = [];
  for (const appointment of appointments) {
    const invoice = invoices.find((i) => String(i.appointmentId) === String(appointment._id));
    const timezone = zoneOf[String(invoice.branchId)];
    const day = DateTime.fromJSDate(invoice.paidAt, { zone: timezone }).toISODate();
    if (day >= from && day <= to) bills.push({ invoice, appointment, timezone, day });
  }
  return bills;
}

// Catches up commission for bills paid between two days that don't have it yet,
// e.g. after an owner sets up pay starting in the past. Lines already written are never changed.
export async function syncCommissions(orgId, { from, to, staffId }) {
  let written = 0;
  for (const bill of await paidBillsBetween(orgId, { from, to, staffId })) {
    written += (await recordInvoiceCommissions(bill)).length;
  }
  return written;
}

// One person's commission in a month ("2026-10"), newest first
export async function monthCommission(ctx, staffId, month) {
  const entries = await CommissionEntry.find(scoped(ctx, { staffId, day: { $gte: `${month}-01`, $lte: `${month}-31` } }))
    .sort({ day: -1, createdAt: -1 })
    .lean();
  return {
    month,
    entries,
    count: entries.length,
    totalSales: entries.reduce((sum, e) => sum + e.saleAmount, 0),
    totalAmount: entries.reduce((sum, e) => sum + e.amount, 0),
  };
}

// Commission so far this month for several people: { staffId: paise }
export async function monthTotals(ctx, staffIds, month) {
  const rows = await CommissionEntry.aggregate([
    // aggregate() doesn't turn text ids into ObjectIds like find() does, so convert them here
    { $match: { orgId: new mongoose.Types.ObjectId(ctx.orgId), staffId: { $in: staffIds.map((id) => new mongoose.Types.ObjectId(String(id))) }, day: { $gte: `${month}-01`, $lte: `${month}-31` } } },
    { $group: { _id: '$staffId', amount: { $sum: '$amount' } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.amount]));
}
