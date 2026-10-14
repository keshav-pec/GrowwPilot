// The pay setup rules. Pure functions (no database), so they are easy to test and explain.
import { DateTime } from 'luxon';
import { AppError } from '../../utils/AppError.js';
import { formatAmount } from '../../utils/money.js';

export const PAY_PARTS = ['monthlyBase', 'dailyRate', 'hourlyRate', 'assignmentRate', 'commissionBps'];

// Which parts each way of paying needs. HYBRID (a mix) takes any two or more.
export const PARTS_BY_MODEL = {
  FIXED: ['monthlyBase'],
  FIXED_COMMISSION: ['monthlyBase', 'commissionBps'],
  COMMISSION: ['commissionBps'],
  DAILY: ['dailyRate'],
  HOURLY: ['hourlyRate'],
  ASSIGNMENT: ['assignmentRate'],
  HYBRID: PAY_PARTS,
};

// Front desk members are never booked, so they can't earn commission or per-service pay
export const FRONT_DESK_PAY_MODELS = ['FIXED', 'DAILY', 'HOURLY'];

export function checkPayModelFor(staff, model) {
  if (staff.kind === 'FRONT_DESK' && !FRONT_DESK_PAY_MODELS.includes(model)) {
    throw new AppError(400, 'FRONT_DESK_PAY', 'Front desk members are paid a monthly salary, per day or per hour (no commission)');
  }
}

const PART_LABEL = {
  monthlyBase: 'Monthly salary',
  dailyRate: 'Day rate',
  hourlyRate: 'Hour rate',
  assignmentRate: 'Amount per service',
  commissionBps: 'Commission',
};

// Keeps only the parts this model uses (others become null) and checks the needed ones are filled in.
//   cleanPayParts({ model: 'FIXED', monthlyBase: 2000000, commissionBps: 1000 })
//   -> { model: 'FIXED', monthlyBase: 2000000, dailyRate: null, ..., commissionBps: null }
export function cleanPayParts(input) {
  const used = PARTS_BY_MODEL[input.model];
  const clean = { model: input.model };
  for (const part of PAY_PARTS) {
    const value = input[part];
    clean[part] = used.includes(part) && value > 0 ? value : null;
  }

  if (input.model === 'HYBRID') {
    if (PAY_PARTS.filter((p) => clean[p] !== null).length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A mix needs at least two pay parts, e.g. a day rate and commission');
    }
  } else {
    const missing = used.filter((p) => clean[p] === null);
    if (missing.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Please enter: ${missing.map((p) => PART_LABEL[p].toLowerCase()).join(', ')}`);
    }
  }
  return clean;
}

// 1000 -> "10%", 1250 -> "12.5%"
export function formatPercent(bps) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// How someone is paid, in words: "₹20,000/month + 10% commission"
export function describePay(plan) {
  if (!plan) return 'No pay setup';
  const parts = [];
  if (plan.monthlyBase) parts.push(`${formatAmount(plan.monthlyBase)}/month`);
  if (plan.dailyRate) parts.push(`${formatAmount(plan.dailyRate)}/day`);
  if (plan.hourlyRate) parts.push(`${formatAmount(plan.hourlyRate)}/hour`);
  if (plan.assignmentRate) parts.push(`${formatAmount(plan.assignmentRate)} per service`);
  if (plan.commissionBps) parts.push(`${formatPercent(plan.commissionBps)} commission`);
  return parts.join(' + ');
}

// "2026-11-01" -> "1 Nov 2026"
export function formatDay(date) {
  return DateTime.fromISO(date).toFormat('d LLL yyyy');
}

// "2026-11-01" -> "2026-10-31"
export function dayBefore(date) {
  return DateTime.fromISO(date).minus({ days: 1 }).toISODate();
}

// Where a plan sits compared with today: 'upcoming' (not started), 'current', or 'past'
export function planStatus(plan, today) {
  if (plan.effectiveFrom > today) return 'upcoming';
  if (plan.effectiveTo && plan.effectiveTo < today) return 'past';
  return 'current';
}

// From one person's plans: the one paying them today, and the next one waiting to start
export function currentAndUpcoming(plans, today) {
  const sorted = [...plans].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return {
    current: sorted.find((p) => planStatus(p, today) === 'current') ?? null,
    upcoming: sorted.find((p) => planStatus(p, today) === 'upcoming') ?? null,
  };
}

// A new plan must start after the latest one starts (plans form one timeline, newest last).
// Returns the end date the latest plan needs so the two don't overlap, or null if it already ends in time.
export function checkNewStart(latest, effectiveFrom, staffName) {
  if (!latest) return null;
  if (effectiveFrom <= latest.effectiveFrom) {
    throw new AppError(
      409,
      'PLAN_DATE_CONFLICT',
      `${staffName}'s latest pay setup starts on ${formatDay(latest.effectiveFrom)}. A new one must start after that.`
    );
  }
  const newEnd = dayBefore(effectiveFrom);
  return !latest.effectiveTo || latest.effectiveTo > newEnd ? newEnd : null;
}
