// How one person's pay for one month is worked out. Pure function (no database), so it's easy to test.
//
//   gross = salary + days worked + hours worked + services done + commission + bonuses
//   net   = gross - deductions
//
// Defaults (PAYROLL_PLAN.md, Part 3), to be confirmed by the owner:
// - Monthly salary is split by calendar days when the pay setup covers only part of the month
//   (joined, left, or pay changed mid-month). It is NOT cut for absences: an owner adds a deduction if needed.
// - Per-day pay counts days marked present. Per-hour pay counts check-in to check-out on those days.
// - Per-service pay counts completed AND paid services, like commission.
import { DateTime } from 'luxon';
import { formatAmount } from '../../utils/money.js';
import { describePay, formatDay } from './payPlan.rules.js';

// "2026-10" -> { start: '2026-10-01', end: '2026-10-31', days: 31 }
export function monthBounds(month) {
  const first = DateTime.fromISO(`${month}-01`);
  return { start: first.toISODate(), end: first.endOf('month').toISODate(), days: first.daysInMonth };
}

const daysBetween = (from, to) => Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days) + 1;
const within = (day, from, to) => day >= from && day <= to;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "10.5 hours", "8 hours"
function formatHours(minutes) {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// The days each plan covers inside the month
function segments(plans, month) {
  const { start, end } = monthBounds(month);
  return [...plans]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((plan) => {
      const from = plan.effectiveFrom > start ? plan.effectiveFrom : start;
      const to = plan.effectiveTo && plan.effectiveTo < end ? plan.effectiveTo : end;
      return { plan, from, to };
    })
    .filter((s) => s.from <= s.to);
}

// input:
//   month        "2026-10"
//   countUntil   last day that has happened ("today" for the current month, otherwise the month's last day)
//   plans        pay setups overlapping the month
//   attendance   [{ date, status, checkInAt, checkOutAt }]
//   paidServiceDays  one day ("2026-10-04") per completed and paid service they did
//   commission   { amount, count, sales } from the commission ledger
//   adjustments  [{ kind: 'bonus' | 'deduction', amount, reason, correctsMonth? }]
//   unpaidServices   completed services in the month that haven't been paid yet
//   isActive     still working here (someone who left with nothing set up isn't flagged)
export function calculateMonthlyPay({ month, countUntil, plans, attendance, paidServiceDays, commission, adjustments, unpaidServices = 0, isActive = true }) {
  const { start, end, days: monthDays } = monthBounds(month);
  const lines = [];
  const notes = [];
  const issues = [];
  const parts = segments(plans, month);
  const several = parts.length > 1;
  const range = (s) => `${formatDay(s.from)} – ${formatDay(s.to)}`;

  if (parts.length === 0) {
    if (isActive) issues.push({ code: 'NO_PAY_SETUP', message: 'No pay setup for this month', blocking: true });
  }

  const present = attendance.filter((a) => a.status === 'present');
  let paidByAttendance = false;

  for (const s of parts) {
    const { plan } = s;
    const segDays = daysBetween(s.from, s.to);
    const when = several ? ` (${range(s)})` : '';

    if (plan.monthlyBase) {
      const full = s.from === start && s.to === end;
      lines.push({
        kind: 'salary',
        label: `Monthly salary${when}`,
        detail: full ? `${formatAmount(plan.monthlyBase)}, full month` : `${formatAmount(plan.monthlyBase)} × ${segDays} of ${monthDays} days`,
        amount: full ? plan.monthlyBase : Math.round((plan.monthlyBase * segDays) / monthDays),
      });
    }

    const daysHere = present.filter((a) => within(a.date, s.from, s.to));
    if (plan.dailyRate) {
      paidByAttendance = true;
      lines.push({ kind: 'daily', label: `Days worked${when}`, detail: `${plural(daysHere.length, 'day')} × ${formatAmount(plan.dailyRate)}`, amount: daysHere.length * plan.dailyRate });
    }

    if (plan.hourlyRate) {
      paidByAttendance = true;
      const timed = daysHere.filter((a) => a.checkInAt && a.checkOutAt);
      const minutes = timed.reduce((sum, a) => sum + Math.round((new Date(a.checkOutAt) - new Date(a.checkInAt)) / 60000), 0);
      lines.push({ kind: 'hourly', label: `Hours worked${when}`, detail: `${formatHours(minutes)} × ${formatAmount(plan.hourlyRate)}`, amount: Math.round((plan.hourlyRate * minutes) / 60) });
      const untimed = daysHere.length - timed.length;
      if (untimed > 0) {
        issues.push({ code: 'MISSING_TIMES', message: `${plural(untimed, 'day')} present without check-in or check-out time (paid per hour)`, blocking: true });
      }
    }

    if (plan.assignmentRate) {
      const count = paidServiceDays.filter((d) => within(d, s.from, s.to)).length;
      lines.push({ kind: 'per_service', label: `Services done${when}`, detail: `${plural(count, 'paid service')} × ${formatAmount(plan.assignmentRate)}`, amount: count * plan.assignmentRate });
    }
  }

  if (commission.amount > 0 || parts.some((s) => s.plan.commissionBps)) {
    lines.push({
      kind: 'commission',
      label: 'Commission',
      detail: commission.count ? `${plural(commission.count, 'paid service')} worth ${formatAmount(commission.sales)}` : 'No paid services yet',
      amount: commission.amount,
    });
  }

  for (const a of adjustments) {
    const fixes = a.correctsMonth ? ` (correction for ${DateTime.fromISO(`${a.correctsMonth}-01`).toFormat('LLL yyyy')})` : '';
    lines.push({ kind: a.kind, label: a.kind === 'bonus' ? 'Bonus' : 'Deduction', detail: `${a.reason}${fixes}`, amount: a.amount });
  }

  // Attendance: days so far with nothing marked, while they had a pay setup
  const marked = new Set(attendance.map((a) => a.date));
  let unmarked = 0;
  for (const s of parts) {
    for (let d = DateTime.fromISO(s.from); d.toISODate() <= s.to && d.toISODate() <= countUntil; d = d.plus({ days: 1 })) {
      if (!marked.has(d.toISODate())) unmarked += 1;
    }
  }
  if (unmarked > 0) {
    issues.push(
      paidByAttendance
        ? { code: 'ATTENDANCE_MISSING', message: `${plural(unmarked, 'day')} with no attendance marked (paid by attendance)`, blocking: true }
        : { code: 'ATTENDANCE_MISSING', message: `${plural(unmarked, 'day')} with no attendance marked`, blocking: false }
    );
  }

  const absent = attendance.filter((a) => a.status === 'absent').length;
  const leave = attendance.filter((a) => a.status === 'leave').length;
  if (absent + leave > 0) {
    const counts = [absent && `${plural(absent, 'day')} absent`, leave && `${plural(leave, 'day')} on leave`].filter(Boolean).join(', ');
    notes.push(parts.some((s) => s.plan.monthlyBase) ? `${counts} (not taken off the salary automatically)` : counts);
  }

  if (unpaidServices > 0 && parts.some((s) => s.plan.commissionBps || s.plan.assignmentRate)) {
    issues.push({ code: 'UNPAID_SERVICES', message: `${plural(unpaidServices, 'finished service')} not paid yet; they’ll count when paid`, blocking: false });
  }

  const earningKinds = ['salary', 'daily', 'hourly', 'per_service', 'commission', 'bonus'];
  const gross = lines.filter((l) => earningKinds.includes(l.kind)).reduce((sum, l) => sum + l.amount, 0);
  const deductions = lines.filter((l) => l.kind === 'deduction').reduce((sum, l) => sum + l.amount, 0);
  const net = gross - deductions;
  if (net < 0) issues.push({ code: 'NEGATIVE_NET', message: 'Deductions are more than the pay for this month', blocking: true });

  const latest = parts.at(-1)?.plan;
  const payDescription = !latest ? 'No pay setup' : several ? `${describePay(latest)} (changed ${formatDay(parts.at(-1).from)})` : describePay(latest);

  return { lines, notes, issues, gross, deductions, net, payDescription };
}
