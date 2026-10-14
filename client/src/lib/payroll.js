import { DateTime } from 'luxon';
import { formatAmount } from './money';

// The ways to pay someone, in the owner's words (the server has the same list in config/constants.js)
export const PAY_MODELS = [
  { value: 'FIXED', label: 'Fixed monthly salary', hint: 'The same amount every month.' },
  { value: 'FIXED_COMMISSION', label: 'Monthly salary + commission', hint: 'A monthly amount plus a share of the services they do.' },
  { value: 'COMMISSION', label: 'Commission only', hint: 'Only a share of the services they do.' },
  { value: 'DAILY', label: 'Per day worked', hint: 'Paid for each day they are marked present.' },
  { value: 'HOURLY', label: 'Per hour worked', hint: 'Paid for the hours between check-in and check-out.' },
  { value: 'ASSIGNMENT', label: 'Per service done', hint: 'A fixed amount for each service they complete.' },
  { value: 'HYBRID', label: 'A mix', hint: 'Any two or more, e.g. a day rate plus commission.' },
];

// Front desk members are never booked, so no commission or per-service pay (same as the server)
const FRONT_DESK_PAY_MODELS = ['FIXED', 'DAILY', 'HOURLY'];
export const isFrontDesk = (staff) => staff?.kind === 'FRONT_DESK';
export const payModelsFor = (staff) => (isFrontDesk(staff) ? PAY_MODELS.filter((m) => FRONT_DESK_PAY_MODELS.includes(m.value)) : PAY_MODELS);

export const PAY_PARTS = [
  { key: 'monthlyBase', label: 'Monthly salary (₹)' },
  { key: 'dailyRate', label: 'Pay per day (₹)' },
  { key: 'hourlyRate', label: 'Pay per hour (₹)' },
  { key: 'assignmentRate', label: 'Pay per service (₹)' },
  { key: 'commissionBps', label: 'Commission (%)' },
];

// Which parts each way of paying needs (same as the server's payPlan.rules.js)
export const PARTS_BY_MODEL = {
  FIXED: ['monthlyBase'],
  FIXED_COMMISSION: ['monthlyBase', 'commissionBps'],
  COMMISSION: ['commissionBps'],
  DAILY: ['dailyRate'],
  HOURLY: ['hourlyRate'],
  ASSIGNMENT: ['assignmentRate'],
  HYBRID: PAY_PARTS.map((p) => p.key),
};

export const modelLabel = (model) => PAY_MODELS.find((m) => m.value === model)?.label ?? model;

// 1000 -> "10%", 1250 -> "12.5%"
export function formatPercent(bps) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// "₹20,000/month + 10% commission"
export function describePay(plan) {
  if (!plan) return 'Not set up yet';
  const parts = [];
  if (plan.monthlyBase) parts.push(`${formatAmount(plan.monthlyBase)}/month`);
  if (plan.dailyRate) parts.push(`${formatAmount(plan.dailyRate)}/day`);
  if (plan.hourlyRate) parts.push(`${formatAmount(plan.hourlyRate)}/hour`);
  if (plan.assignmentRate) parts.push(`${formatAmount(plan.assignmentRate)} per service`);
  if (plan.commissionBps) parts.push(`${formatPercent(plan.commissionBps)} commission`);
  return parts.join(' + ');
}

// "2026-11-01" -> "1 Nov 2026"
export function formatPayDay(date) {
  return date ? DateTime.fromISO(date).toFormat('d LLL yyyy') : '';
}

// "2026-10-10" -> "2026-10-01" (this month) or "2026-11-01" (next month)
export function firstOfMonth(date, monthsAhead = 0) {
  return DateTime.fromISO(date).plus({ months: monthsAhead }).startOf('month').toISODate();
}

// "2026-10" -> "October 2026"
export function formatMonth(month) {
  return DateTime.fromISO(`${month}-01`).toFormat('LLLL yyyy');
}

// "2026-10" -> "2026-11"
export function nextMonth(month) {
  return DateTime.fromISO(`${month}-01`).plus({ months: 1 }).toFormat('yyyy-MM');
}

// How salaries and advances are paid (the server has the same list)
export const SALARY_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK', label: 'Bank transfer' },
];
export const salaryMethodLabel = (method) => SALARY_METHODS.find((m) => m.value === method)?.label ?? method;

// Lines that are taken off pay
export const isDeductionLine = (line) => line.kind === 'deduction' || line.kind === 'advance';
