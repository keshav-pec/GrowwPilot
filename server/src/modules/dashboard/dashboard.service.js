// The owner's dashboard: "Is my salon doing fine, and what needs my attention?"
// Everything is calculated live from the database for the selected branch. Nothing is stored or hard-coded.
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Attendance, Branch, Invoice, Lead, Staff } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES } from '../../config/constants.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { dayRangeUTC, formatTime } from '../../utils/time.js';
import { getAppointmentAlert } from '../../utils/appointmentAlerts.js';

const OPEN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED'];
const AWAY = ['absent', 'leave'];

// Sum of invoice totals paid between two times (revenue = invoices, so cancelled bookings never count)
async function revenueBetween(ctx, branchId, from, to) {
  const [row] = await Invoice.aggregate([
    { $match: { orgId: new mongoose.Types.ObjectId(ctx.orgId), branchId, paidAt: { $gte: from, $lt: to } } },
    { $group: { _id: null, total: { $sum: '$total' } } },
  ]);
  return row?.total ?? 0;
}

// "5h 15m"
function hoursAndMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

// ---------------------------------------------------------------------------
// 1. KPIs
// ---------------------------------------------------------------------------
async function getKpis(ctx, branch, today, todayAppointments) {
  const since30Days = DateTime.now().minus({ days: 30 }).toJSDate();
  const base = scoped(ctx, { branchId: branch._id });

  const [revenue, openLeads, leads30, converted30] = await Promise.all([
    revenueBetween(ctx, branch._id, today.start, today.end),
    Lead.countDocuments({ ...base, status: { $in: OPEN_LEAD_STATUSES } }),
    Lead.countDocuments({ ...base, createdAt: { $gte: since30Days } }),
    Lead.countDocuments({ ...base, createdAt: { $gte: since30Days }, status: 'APPOINTMENT_BOOKED' }),
  ]);

  const booked = todayAppointments.filter((a) => a.status !== 'CANCELLED');
  const served = new Set(todayAppointments.filter((a) => a.status === 'COMPLETED').map((a) => String(a.customerId)));

  return {
    todayRevenue: revenue,
    todayAppointments: booked.length,
    customersServed: served.size,
    openLeads,
    leadConversion: { converted: converted30, total: leads30, rate: leads30 ? Math.round((converted30 / leads30) * 100) : null },
  };
}

// ---------------------------------------------------------------------------
// 2. Requires attention: a to-do list, most urgent first, each with a one-click action
// ---------------------------------------------------------------------------
async function getAttention(ctx, branch, now, todayAppointments) {
  const zone = branch.timezone;
  const base = scoped(ctx, { branchId: branch._id });
  const when = (date) => DateTime.fromJSDate(date, { zone }).toFormat('d LLL, h:mm a');
  const items = [];

  // a) Today's appointments that are late, waiting, or might be a no-show
  const alertText = {
    NO_SHOW: (a) => ({ severity: 'high', title: `${a.customerSnapshot.name} hasn't arrived`, detail: `Booked for ${formatTime(a.startAt, zone)} with ${a.items[0].staffName}` }),
    WAITING: (a) => ({ severity: 'high', title: `${a.customerSnapshot.name} is waiting`, detail: `Arrived for ${formatTime(a.startAt, zone)}, service hasn't started` }),
    RUNNING_LATE: (a) => ({ severity: 'medium', title: `${a.customerSnapshot.name}'s appointment is running late`, detail: `Should have finished at ${formatTime(a.endAt, zone)} (${a.items.at(-1).staffName})` }),
  };
  for (const a of todayAppointments) {
    const alert = getAppointmentAlert(a, now);
    if (alert) items.push({ id: `${alert}-${a._id}`, kind: alert, at: a.startAt, ...alertText[alert](a), action: { label: 'Open', to: `/app/today?open=${a._id}` } });
  }

  const [unpaid, overdueLeads, uncontacted, upcoming, staff, absences] = await Promise.all([
    // b) Finished but not paid: money not collected
    Appointment.find({ ...base, status: 'COMPLETED', invoiceId: null }).sort({ startAt: -1 }).limit(20).lean(),
    // c) Lead follow-ups that are overdue
    Lead.find({ ...base, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lt: now } }).sort({ nextFollowUpAt: 1 }).limit(20).lean(),
    // d) New leads nobody has contacted for more than 24 hours (not already listed as overdue)
    Lead.find({
      ...base,
      status: 'NEW',
      createdAt: { $lt: new Date(now - 24 * 3600 * 1000) },
      $or: [{ nextFollowUpAt: null }, { nextFollowUpAt: { $gte: now } }],
    })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean(),
    // e) Upcoming bookings (next 14 days) whose stylist is inactive, absent or on leave
    Appointment.find({ ...base, status: { $in: OPEN_APPOINTMENT_STATUSES }, startAt: { $gte: now, $lt: new Date(+now + 14 * 86400 * 1000) } }).lean(),
    Staff.find(base).select('name status').lean(),
    Attendance.find({ ...base, status: { $in: AWAY }, date: { $gte: DateTime.fromJSDate(now, { zone }).toISODate() } }).lean(),
  ]);

  for (const a of unpaid) {
    items.push({ id: `UNPAID-${a._id}`, kind: 'UNPAID', severity: 'high', at: a.startAt, title: `${a.customerSnapshot.name} hasn't paid`, detail: `Completed ${when(a.startAt)} · ${formatMoney(a.totalPrice)}`, action: { label: 'Checkout', to: `/app/checkout/${a._id}` } });
  }
  for (const l of overdueLeads) {
    items.push({ id: `FOLLOW_UP-${l._id}`, kind: 'FOLLOW_UP', severity: 'medium', at: l.nextFollowUpAt, title: `Follow up with ${l.name}`, detail: `Follow-up was due ${when(l.nextFollowUpAt)} · ${l.source} lead`, action: { label: 'Open lead', to: `/app/leads?open=${l._id}` } });
  }
  for (const l of uncontacted) {
    items.push({ id: `NEW_LEAD-${l._id}`, kind: 'NEW_LEAD', severity: 'medium', at: l.createdAt, title: `${l.name} hasn't been contacted`, detail: `New ${l.source} lead from ${when(l.createdAt)}`, action: { label: 'Open lead', to: `/app/leads?open=${l._id}` } });
  }

  const staffById = Object.fromEntries(staff.map((s) => [s._id, s]));
  for (const a of upcoming) {
    const day = DateTime.fromJSDate(a.startAt, { zone }).toISODate();
    const problem = a.items
      .map((item) => {
        const person = staffById[item.staffId];
        if (person && person.status !== 'active') return `${item.staffName} is ${person.status}`;
        const away = absences.find((x) => String(x.staffId) === String(item.staffId) && x.date === day);
        return away ? `${item.staffName} is ${away.status === 'leave' ? 'on leave' : 'absent'}` : null;
      })
      .find(Boolean);
    if (problem) {
      items.push({ id: `STAFF-${a._id}`, kind: 'STAFF', severity: 'high', at: a.startAt, title: `${a.customerSnapshot.name}'s booking needs a new stylist`, detail: `${problem} · ${when(a.startAt)}`, action: { label: 'Reassign', to: `/app/appointments/${a._id}/edit` } });
    }
  }

  // Most urgent first, then oldest first
  const rank = { high: 0, medium: 1 };
  return items.sort((x, y) => rank[x.severity] - rank[y.severity] || new Date(x.at) - new Date(y.at));
}

// ---------------------------------------------------------------------------
// 3. Salon Pulse: one verdict from 3 simple signals, each with a one-line reason
//    status: 'good' | 'watch' | 'action' | 'neutral' (not enough data, doesn't affect the verdict)
// ---------------------------------------------------------------------------
async function getPulse(ctx, branch, now, today, todayAppointments, attention) {
  const zone = branch.timezone;
  const nowLocal = DateTime.fromJSDate(now, { zone });
  const weekday = nowLocal.toFormat('cccc'); // "Monday"

  // Signal 1: revenue so far today vs the average of the same weekday in the last 4 weeks, up to the same time of day
  const elapsed = now - today.start;
  const todaySoFar = await revenueBetween(ctx, branch._id, today.start, now);
  const pastWeeks = await Promise.all(
    [1, 2, 3, 4].map((weeks) => {
      const dayStart = DateTime.fromJSDate(today.start, { zone }).minus({ weeks }).toJSDate();
      return revenueBetween(ctx, branch._id, dayStart, new Date(+dayStart + elapsed));
    })
  );
  const usual = Math.round(pastWeeks.reduce((sum, x) => sum + x, 0) / 4);
  let revenue;
  if (usual === 0) {
    revenue = { status: 'neutral', reason: `Not enough history yet to compare with a usual ${weekday}.` };
  } else {
    const change = Math.round(((todaySoFar - usual) / usual) * 100);
    const status = change >= -10 ? 'good' : change >= -30 ? 'watch' : 'action';
    revenue = { status, reason: `Revenue is ${Math.abs(change)}% ${change >= 0 ? 'above' : 'below'} a usual ${weekday} by this time (${formatMoney(todaySoFar)} vs ${formatMoney(usual)}).` };
  }

  // Signal 2: chairs filled = booked stylist-minutes / available stylist-minutes today
  const [workingStaff, awayToday] = await Promise.all([
    Staff.find(scoped(ctx, { branchId: branch._id, status: 'active' })).select('_id').lean(),
    Attendance.find(scoped(ctx, { branchId: branch._id, date: nowLocal.toISODate(), status: { $in: AWAY } })).select('staffId').lean(),
  ]);
  const inToday = workingStaff.filter((s) => !awayToday.some((a) => String(a.staffId) === String(s._id))).length;
  const opens = DateTime.fromISO(`${nowLocal.toISODate()}T${branch.openTime}`, { zone });
  const closes = DateTime.fromISO(`${nowLocal.toISODate()}T${branch.closeTime}`, { zone });
  const available = inToday * closes.diff(opens, 'minutes').minutes;
  const booked = todayAppointments.filter((a) => a.status !== 'CANCELLED').flatMap((a) => a.items).reduce((sum, i) => sum + i.durationMinutes, 0);
  let chairs;
  if (available === 0) {
    chairs = { status: 'neutral', reason: 'No stylists are working today.' };
  } else {
    const filled = Math.round((booked / available) * 100);
    chairs = {
      status: filled >= 60 ? 'good' : filled >= 30 ? 'watch' : 'action',
      reason: `Chairs are ${filled}% booked today (${hoursAndMinutes(booked)} of ${hoursAndMinutes(available)} stylist time).`,
    };
  }

  // Signal 3: how many urgent items need someone right now
  const urgent = attention.filter((i) => i.severity === 'high').length;
  const attentionSignal = {
    status: urgent === 0 ? 'good' : urgent <= 3 ? 'watch' : 'action',
    reason: urgent === 0 ? 'Nothing urgent needs you right now.' : `${urgent} urgent item${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} attention below.`,
  };

  const signals = [
    { key: 'revenue', label: 'Revenue vs usual', ...revenue },
    { key: 'chairs', label: 'Chairs filled', ...chairs },
    { key: 'attention', label: 'Attention', ...attentionSignal },
  ];

  // Verdict: any "action" -> Needs action; any "watch" -> Keep an eye; otherwise Doing well
  const statuses = signals.map((s) => s.status);
  const verdict = statuses.includes('action') ? 'action' : statuses.includes('watch') ? 'watch' : 'good';
  return { verdict, signals };
}

export async function getDashboard(ctx) {
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).lean();
  const now = new Date();
  const todayDate = DateTime.fromJSDate(now, { zone: branch.timezone }).toISODate(); // "today" at the branch
  const today = dayRangeUTC(todayDate, branch.timezone);

  const todayAppointments = await Appointment.find(scoped(ctx, { branchId: branch._id, startAt: { $gte: today.start, $lt: today.end } })).lean();

  const kpis = await getKpis(ctx, branch, today, todayAppointments);
  const attention = await getAttention(ctx, branch, now, todayAppointments);
  const pulse = await getPulse(ctx, branch, now, today, todayAppointments, attention);

  return { branch: { _id: branch._id, name: branch.name, timezone: branch.timezone }, date: todayDate, generatedAt: now, kpis, pulse, attention };
}
