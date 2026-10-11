import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Branch, CommissionEntry, CommissionRule, Invoice, PayPlan } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';
import { commissionAmount, pickRate, splitByPrice } from './commission.rules.js';

// Commission is earned when a service is completed AND paid, i.e. at checkout (the app only lets
// completed appointments be paid, and always in full). It's worked out on what the customer actually
// paid: the bill total after discount, shared across its services. The app has no GST, so nothing to take out.

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

// Writes the commission lines for one paid bill. Lines that already exist are skipped,
// so calling it again for the same bill never pays commission twice.
export async function recordInvoiceCommissions({ invoice, appointment, timezone }, session) {
  const day = DateTime.fromJSDate(invoice.paidAt, { zone: timezone }).toISODate();
  const items = appointment.items;
  const shares = splitByPrice(items.map((i) => i.price), invoice.total);

  const staffIds = [...new Set(items.map((i) => String(i.staffId)))];
  const [plans, rules, existing] = await Promise.all([
    plansOnDay(invoice.orgId, staffIds, day, session),
    CommissionRule.find({ orgId: invoice.orgId, staffId: { $in: staffIds }, serviceId: { $in: items.map((i) => i.serviceId) } })
      .session(session ?? null)
      .lean(),
    CommissionEntry.find({ invoiceId: invoice._id, type: 'earned' }).select('itemId').session(session ?? null).lean(),
  ]);
  const done = new Set(existing.map((e) => String(e.itemId)));

  const entries = [];
  items.forEach((item, index) => {
    if (done.has(String(item._id))) return;
    const rule = rules.find((r) => String(r.staffId) === String(item.staffId) && String(r.serviceId) === String(item.serviceId));
    const rate = pickRate(plans[String(item.staffId)], rule);
    if (!rate || rate.rateBps === 0) return;
    entries.push({
      orgId: invoice.orgId,
      branchId: invoice.branchId,
      staffId: item.staffId,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId: appointment._id,
      itemId: item._id,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      day,
      saleAmount: shares[index],
      ...rate,
      amount: commissionAmount(shares[index], rate.rateBps),
    });
  });

  if (entries.length > 0) await CommissionEntry.insertMany(entries, { session });
  return entries;
}

// Bills paid between two branch-local days (inclusive), each with its appointment, branch timezone and paid day.
// staffId: only bills where that person did a service.
export async function paidBillsBetween(orgId, { from, to, staffId }) {
  // A day either side covers every timezone; the exact branch day is checked below
  const invoices = await Invoice.find({
    orgId,
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
