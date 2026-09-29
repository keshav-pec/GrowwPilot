// Demand analytics: which branches, time slots, stylists and services are most in demand.
// Everything is a MongoDB aggregation over the chosen date range and branches.
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Attendance, Branch, Invoice, Lead, Organization, Staff } from '../../models/index.js';
import { LEAD_SOURCES, PAYMENT_METHODS } from '../../config/constants.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { dayRangeUTC } from '../../utils/time.js';

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

// Which branches the report covers: one branch, or every branch this owner may see
async function loadBranches(ctx, branchId) {
  const ids = branchId === 'all' ? ctx.allowedBranchIds : [branchId];
  if (!ids.every((id) => ctx.allowedBranchIds.includes(id))) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return Branch.find(scoped(ctx, { _id: { $in: ids } })).sort('name').lean();
}

// Each branch's dates are read in THAT branch's timezone, e.g. "28 Sep" = 28 Sep in Kolkata for Andheri.
// { $or: [ { branchId: A, startAt: {...A's range} }, { branchId: B, startAt: {...B's range} } ] }
function dateRangeFilter(branches, field, from, to) {
  return {
    $or: branches.map((b) => ({
      branchId: b._id,
      [field]: { $gte: dayRangeUTC(from, b.timezone).start, $lt: dayRangeUTC(to, b.timezone).end },
    })),
  };
}

// Minutes a branch is open each day, e.g. 10:00–21:00 = 660
const openMinutes = (b) => DateTime.fromFormat(b.closeTime, 'HH:mm').diff(DateTime.fromFormat(b.openTime, 'HH:mm'), 'minutes').minutes;

export async function getAnalytics(ctx, { from, to, branchId }) {
  const branches = await loadBranches(ctx, branchId);
  const orgId = new mongoose.Types.ObjectId(ctx.orgId); // aggregate() doesn't convert ids for us
  const bookingsMatch = { orgId, status: { $ne: 'CANCELLED' }, ...dateRangeFilter(branches, 'startAt', from, to) };
  const invoicesMatch = { orgId, ...dateRangeFilter(branches, 'paidAt', from, to) };
  const leadsMatch = { orgId, ...dateRangeFilter(branches, 'createdAt', from, to) };
  const days = DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days + 1;

  const [bookingsByBranch, revenueByBranch, byStylist, byService, bySource, byMethod, slotGroups] = await Promise.all([
    // Branch demand: bookings (not cancelled) and revenue (invoices) per branch
    Appointment.aggregate([{ $match: bookingsMatch }, { $group: { _id: '$branchId', bookings: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: invoicesMatch }, { $group: { _id: '$branchId', revenue: { $sum: '$total' }, invoices: { $sum: 1 } } }]),

    // Stylist demand: one row per stylist. "Service value" = list price of their completed services.
    Appointment.aggregate([
      { $match: bookingsMatch },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.staffId',
          name: { $last: '$items.staffName' },
          appointmentIds: { $addToSet: '$_id' },
          bookedMinutes: { $sum: '$items.durationMinutes' },
          serviceValue: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, '$items.price', 0] } },
        },
      },
      { $project: { name: 1, bookings: { $size: '$appointmentIds' }, bookedMinutes: 1, serviceValue: 1 } },
      { $sort: { bookings: -1, name: 1 } }, // ties in name order, so rows don't swap between loads
    ]),

    // Service demand: how often each service is booked, and its value when completed
    Appointment.aggregate([
      { $match: bookingsMatch },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.serviceId',
          name: { $last: '$items.serviceName' },
          bookings: { $sum: 1 },
          serviceValue: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, '$items.price', 0] } },
        },
      },
      { $sort: { bookings: -1, name: 1 } }, // ties in name order, so rows don't swap between loads
    ]),

    // Lead sources: leads created in the range, and how many became appointments
    Lead.aggregate([
      { $match: leadsMatch },
      { $group: { _id: '$source', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'APPOINTMENT_BOOKED'] }, 1, 0] } } } },
    ]),

    // Payment mix: split payments are unwound so ₹1,000 card + ₹500 UPI count in each method
    Invoice.aggregate([
      { $match: invoicesMatch },
      { $unwind: '$payments' },
      { $group: { _id: '$payments.method', amount: { $sum: '$payments.amount' }, payments: { $sum: 1 } } },
    ]),

    // Slot demand: bookings by weekday x hour, in each branch's LOCAL time (one aggregation per branch)
    Promise.all(
      branches.map((b) =>
        Appointment.aggregate([
          { $match: { orgId, branchId: b._id, status: { $ne: 'CANCELLED' }, startAt: { $gte: dayRangeUTC(from, b.timezone).start, $lt: dayRangeUTC(to, b.timezone).end } } },
          {
            $group: {
              _id: { day: { $isoDayOfWeek: { date: '$startAt', timezone: b.timezone } }, hour: { $hour: { date: '$startAt', timezone: b.timezone } } },
              count: { $sum: 1 },
            },
          },
        ])
      )
    ),
  ]);

  // ----- Branches -----
  const branchRows = branches.map((b) => {
    const bookings = bookingsByBranch.find((x) => String(x._id) === String(b._id))?.bookings ?? 0;
    const money = revenueByBranch.find((x) => String(x._id) === String(b._id));
    const revenue = money?.revenue ?? 0;
    const invoices = money?.invoices ?? 0;
    return { branchId: b._id, name: b.name, bookings, revenue, invoices, avgTicket: invoices ? Math.round(revenue / invoices) : 0 };
  });

  // ----- Slots: merge every branch into one weekday x hour grid -----
  const counts = {};
  for (const group of slotGroups.flat()) {
    const key = `${group._id.day}-${group._id.hour}`;
    counts[key] = (counts[key] ?? 0) + group.count;
  }
  const firstHour = Math.min(...branches.map((b) => Number(b.openTime.slice(0, 2))));
  const lastHour = Math.max(...branches.map((b) => Number(b.closeTime.slice(0, 2)) - (b.closeTime.endsWith(':00') ? 1 : 0)));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => hours.map((hour) => ({ day, hour, count: counts[`${day}-${hour}`] ?? 0 })));

  // ----- Stylists: utilisation = booked minutes / minutes they could have worked -----
  const staffDocs = await Staff.find(scoped(ctx, { _id: { $in: byStylist.map((s) => s._id) } })).select('branchId').lean();
  const awayDays = await Attendance.aggregate([
    { $match: { orgId, staffId: { $in: byStylist.map((s) => s._id) }, status: { $in: ['absent', 'leave'] }, date: { $gte: from, $lte: to } } },
    { $group: { _id: '$staffId', days: { $sum: 1 } } },
  ]);
  const stylists = byStylist.map((s) => {
    const branch = branches.find((b) => String(b._id) === String(staffDocs.find((d) => String(d._id) === String(s._id))?.branchId));
    const workDays = days - (awayDays.find((a) => String(a._id) === String(s._id))?.days ?? 0);
    const available = branch ? workDays * openMinutes(branch) : 0;
    return { staffId: s._id, name: s.name, bookings: s.bookings, bookedMinutes: s.bookedMinutes, serviceValue: s.serviceValue, utilisation: percent(s.bookedMinutes, available) };
  });

  // ----- Totals -----
  const revenue = branchRows.reduce((sum, b) => sum + b.revenue, 0);
  const invoices = branchRows.reduce((sum, b) => sum + b.invoices, 0);
  const paid = byMethod.reduce((sum, m) => sum + m.amount, 0);

  return {
    from,
    to,
    branchId,
    branches: branches.map((b) => ({ _id: b._id, name: b.name, timezone: b.timezone })),
    totals: { revenue, bookings: branchRows.reduce((sum, b) => sum + b.bookings, 0), invoices, avgTicket: invoices ? Math.round(revenue / invoices) : 0 },
    branchDemand: branchRows,
    slotDemand: { hours, slots },
    stylistDemand: stylists,
    serviceDemand: byService.map((s) => ({ serviceId: s._id, name: s.name, bookings: s.bookings, serviceValue: s.serviceValue })),
    leadSources: LEAD_SOURCES.map((source) => {
      const row = bySource.find((x) => x._id === source);
      return { source, leads: row?.leads ?? 0, converted: row?.converted ?? 0, rate: percent(row?.converted ?? 0, row?.leads ?? 0) };
    }).filter((r) => r.leads > 0),
    paymentMix: PAYMENT_METHODS.map((method) => {
      const row = byMethod.find((x) => x._id === method);
      return { method, amount: row?.amount ?? 0, payments: row?.payments ?? 0, share: percent(row?.amount ?? 0, paid) };
    }),
  };
}

// Salon name for the PDF title and file name
export async function getSalonName(ctx) {
  return (await Organization.findById(ctx.orgId).select('name').lean())?.name ?? 'Salon';
}
