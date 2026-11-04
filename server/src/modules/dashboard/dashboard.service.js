// The owner's dashboard: "Is my salon doing fine, and what needs my attention?"
// Everything is calculated live from the database for the selected branch. Nothing is stored or hard-coded.
import { DateTime } from 'luxon';
import { Appointment, Attendance, Lead, Staff } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES, SERVICE_STAFF } from '../../config/constants.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { dayRangeUTC, formatTime } from '../../utils/time.js';
import { getAppointmentAlert } from '../../utils/appointmentAlerts.js';
import { moneyByBranch } from '../billing/reports.service.js';
import { activeBranch } from '../branches/activeBranch.js';

const OPEN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED'];
const AWAY = ['absent', 'leave'];

// Net sales between two times: bills issued (after discounts, without GST) less refunds, so cancelled
// bookings, drafts and voided bills never count. Also what was collected (money in less money handed back).
async function moneyBetween(ctx, branchId, from, to) {
  return (await moneyByBranch(ctx.orgId, [{ branchId, start: from, end: to }]))[String(branchId)];
}

// "5h 15m"
function hoursAndMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Requires attention: a to-do list, most urgent first, each with a one-click action
// ---------------------------------------------------------------------------
async function getAttention(ctx, branch, now, todayAppointments) {
  const zone = branch.timezone;
  const base = scoped(ctx, { branchId: branch._id });
  const when = (date) => DateTime.fromJSDate(date, { zone }).toFormat('d LLL, h:mm a');
  const items = [];

  // Today's appointments that are late, waiting, or might be a no-show
  const alertText = {
    NO_SHOW: (a) => ({ severity: 'high', title: `${a.customerSnapshot.name} hasn't arrived`, detail: `Booked for ${formatTime(a.startAt, zone)} with ${a.items[0].staffName}` }),
    WAITING: (a) => ({ severity: 'high', title: `${a.customerSnapshot.name} is waiting`, detail: `Arrived for ${formatTime(a.startAt, zone)}, service hasn't started` }),
    RUNNING_LATE: (a) => ({ severity: 'medium', title: `${a.customerSnapshot.name}'s appointment is running late`, detail: `Should have finished at ${formatTime(a.endAt, zone)} (${a.items.at(-1).staffName})` }),
  };
  for (const a of todayAppointments) {
    const alert = getAppointmentAlert(a, now);
    if (alert) items.push({ id: `${alert}-${a._id}`, kind: alert, at: a.startAt, ...alertText[alert](a), action: { label: 'Open', to: `/app/today?open=${a._id}` } });
  }

  const [unbilled, overdueLeads, upcoming, staff, absences] = await Promise.all([
    // Finished but not billed yet: money not collected
    Appointment.find({ ...base, status: 'COMPLETED', invoiceId: null }).sort({ startAt: -1 }).limit(20).lean(),
    // Lead follow-ups that are overdue
    Lead.find({ ...base, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lt: now } }).sort({ nextFollowUpAt: 1 }).limit(20).lean(),
    // Upcoming bookings (next 14 days) whose stylist is inactive, absent or on leave
    Appointment.find({ ...base, status: { $in: OPEN_APPOINTMENT_STATUSES }, startAt: { $gte: now, $lt: new Date(+now + 14 * 86400 * 1000) } }).lean(),
    Staff.find(base).select('name status').lean(),
    Attendance.find({ ...base, status: { $in: AWAY }, date: { $gte: DateTime.fromJSDate(now, { zone }).toISODate() } }).lean(),
  ]);

  for (const a of unbilled) {
    items.push({ id: `UNPAID-${a._id}`, kind: 'UNPAID', severity: 'high', at: a.startAt, title: `${a.customerSnapshot.name} hasn't paid`, detail: `Completed ${when(a.startAt)} · ${formatMoney(a.totalPrice)}`, action: { label: 'Checkout', to: `/app/checkout/${a._id}` } });
  }
  for (const l of overdueLeads) {
    items.push({ id: `FOLLOW_UP-${l._id}`, kind: 'FOLLOW_UP', severity: 'medium', at: l.nextFollowUpAt, title: `Follow up with ${l.name}`, detail: `Follow-up was due ${when(l.nextFollowUpAt)} · ${l.source} lead`, action: { label: 'Open lead', to: `/app/leads?open=${l._id}` } });
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
// Salon Pulse: 2 simple signals, each with a one-line reason
//    status: 'good' | 'watch' | 'action' | 'neutral' (not enough data)
// ---------------------------------------------------------------------------
async function getSignals(ctx, branch, now, today, todaySoFar, todayAppointments) {
  const zone = branch.timezone;
  const nowLocal = DateTime.fromJSDate(now, { zone });
  const weekday = nowLocal.toFormat('cccc'); // "Monday"

  // Net sales so far today vs the average of the same weekday in the last 4 weeks, up to the same time of day
  const elapsed = now - today.start;
  const pastWeeks = await Promise.all(
    [1, 2, 3, 4].map(async (weeks) => {
      const dayStart = DateTime.fromJSDate(today.start, { zone }).minus({ weeks }).toJSDate();
      return (await moneyBetween(ctx, branch._id, dayStart, new Date(+dayStart + elapsed))).netSales;
    })
  );
  const usual = Math.round(pastWeeks.reduce((sum, x) => sum + x, 0) / 4);
  let revenue;
  if (usual === 0) {
    revenue = { status: 'neutral', reason: `Not enough history to compare with a usual ${weekday}.` };
  } else {
    const change = Math.round(((todaySoFar - usual) / usual) * 100);
    const status = change >= -10 ? 'good' : change >= -30 ? 'watch' : 'action';
    revenue = { status, reason: `Net sales are ${Math.abs(change)}% ${change >= 0 ? 'above' : 'below'} a usual ${weekday} by this time (${formatMoney(todaySoFar)} vs ${formatMoney(usual)}).` };
  }

  // Chairs filled = booked stylist-minutes / available stylist-minutes today
  const [workingStaff, awayToday] = await Promise.all([
    Staff.find(scoped(ctx, { branchId: branch._id, status: 'active', ...SERVICE_STAFF })).select('_id').lean(),
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

  return [
    { key: 'revenue', label: 'Revenue vs usual', ...revenue },
    { key: 'chairs', label: 'Chairs filled', ...chairs },
  ];
}

export async function getDashboard(ctx) {
  const branch = await activeBranch(ctx);
  const now = new Date();
  const todayDate = DateTime.fromJSDate(now, { zone: branch.timezone }).toISODate(); // "today" at the branch
  const today = dayRangeUTC(todayDate, branch.timezone);

  const [todayAppointments, money, soFar, openLeads] = await Promise.all([
    Appointment.find(scoped(ctx, { branchId: branch._id, startAt: { $gte: today.start, $lt: today.end } })).lean(),
    moneyBetween(ctx, branch._id, today.start, today.end),
    moneyBetween(ctx, branch._id, today.start, now),
    Lead.countDocuments(scoped(ctx, { branchId: branch._id, status: { $in: OPEN_LEAD_STATUSES } })),
  ]);

  const kpis = {
    todayRevenue: money.netSales, // net sales: after discounts and refunds, without GST
    todayCollected: money.collected,
    todayAppointments: todayAppointments.filter((a) => a.status !== 'CANCELLED').length,
    openLeads,
  };
  const [signals, attention] = await Promise.all([
    getSignals(ctx, branch, now, today, soFar.netSales, todayAppointments),
    getAttention(ctx, branch, now, todayAppointments),
  ]);

  return { branch: { _id: branch._id, name: branch.name, timezone: branch.timezone }, date: todayDate, generatedAt: now, kpis, signals, attention };
}
