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
// Lines that already exist are skipped, so calling it again for the same bill never pays commission twice.
export async function recordInvoiceCommissions({ invoice, appointment, timezone }, session) {
  const day = DateTime.fromJSDate(invoice.paidAt, { zone: timezone }).toISODate();
  // Who did each service comes from the bill line (the appointment as a fallback)
  const lines = invoice.lines
    .filter((l) => l.kind === 'SERVICE' && l.itemId)
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
    CommissionEntry.find({ invoiceId: invoice._id, type: 'earned' }).select('itemId').session(session ?? null).lean(),
  ]);
  const done = new Set(existing.map((e) => String(e.itemId)));

  const entries = [];
  for (const line of lines) {
    if (done.has(String(line.itemId))) continue;
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
    });
  }

  if (entries.length > 0) await CommissionEntry.insertMany(entries, { session });
  return entries;
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
