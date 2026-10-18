import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Attendance, Branch, CommissionEntry, EmployeeAdvance, Invoice, PayPlan, PayrollAdjustment, PayrollItem, PayrollPayment, PayrollRun, Staff } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatAmount } from '../../utils/money.js';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { findStaff } from '../staff/staff.service.js';
import { actorRole, logActivity } from '../activity/activity.service.js';
import { businessOwnerIds, notify } from '../notifications/notifications.service.js';
import { paidBillsBetween, syncCommissions } from './commission.service.js';
import { advanceRepayment, calculateMonthlyPay, monthBounds, monthName } from './monthlyPay.rules.js';

// Monthly payroll for the branch picked in the branch switcher. Owners only (branch owners: their branches).
// A draft month is worked out again when opened (if it's a few minutes old) or on "Recalculate".
// Locking freezes it; after that, corrections go into a later month as bonuses or deductions with a reason.

const STALE_AFTER_MINUTES = 5;
const MONTH_LINK = (month) => `/app/payroll?tab=month&month=${month}`;


async function activeBranch(ctx) {
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('name timezone').lean();
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branch;
}

// Log a payroll action and tell the business owner(s) (unless they did it themselves)
export async function recordPayrollAction(ctx, { action, branchId, staffId, summary, before, after }, session) {
  await logActivity(ctx, { action, branchId, staffId, summary, before, after }, session);
  await notify(ctx, await businessOwnerIds(ctx), { message: `${ctx.userName} (${actorRole(ctx)}): ${summary}`, link: MONTH_LINK(after?.month ?? before?.month) }, session);
}

// Completed visits in a period whose bill isn't fully paid yet (or that have no bill at all)
async function unpaidVisits(ctx, branchId, startAt) {
  const visits = await Appointment.find(scoped(ctx, { branchId, status: 'COMPLETED', startAt })).select('items.staffId invoiceId').lean();
  const billIds = visits.map((a) => a.invoiceId).filter(Boolean);
  const paid = new Set((await Invoice.find(scoped(ctx, { _id: { $in: billIds }, settlementStatus: 'PAID' })).select('_id').lean()).map((i) => String(i._id)));
  return visits.filter((a) => !a.invoiceId || !paid.has(String(a.invoiceId)));
}

// Everything the calculation needs for one branch and month, read in one go
async function gatherMonth(ctx, branch, month) {
  const { start, end } = monthBounds(month);
  const today = todayInZone(branch.timezone);
  if (start > today) throw new AppError(400, 'FUTURE_MONTH', 'This month hasn’t started yet');
  const countUntil = end < today ? end : today;

  // Bills paid before a pay setup existed get their commission now (never changes lines already written)
  await syncCommissions(ctx.orgId, { from: start, to: countUntil });

  // Service staff and front desk members (front desk never has commission or per-service pay)
  const staff = await Staff.find(scoped(ctx, { branchId: branch._id })).select('name role status kind').sort('name').lean();
  const staffIds = staff.map((s) => s._id);
  const monthUTC = { $gte: dayRangeUTC(start, branch.timezone).start, $lt: dayRangeUTC(end, branch.timezone).end };

  const [plans, attendance, commission, bills, unpaid, adjustments, advances] = await Promise.all([
    PayPlan.find(scoped(ctx, { staffId: { $in: staffIds }, effectiveFrom: { $lte: end }, $or: [{ effectiveTo: null }, { effectiveTo: { $gte: start } }] })).lean(),
    Attendance.find(scoped(ctx, { staffId: { $in: staffIds }, date: { $gte: start, $lte: end } })).lean(),
    CommissionEntry.find(scoped(ctx, { staffId: { $in: staffIds }, day: { $gte: start, $lte: end } })).select('staffId amount saleAmount').lean(),
    paidBillsBetween(ctx.orgId, { from: start, to: end }),
    // Finished but not fully paid (not billed, or a bill with something still due): no commission or per-service pay yet
    unpaidVisits(ctx, branch._id, monthUTC),
    PayrollAdjustment.find(scoped(ctx, { branchId: branch._id, month })).sort('createdAt').lean(),
    EmployeeAdvance.find(scoped(ctx, { staffId: { $in: staffIds }, firstMonth: { $lte: month } })).lean(),
  ]);

  const mine = (rows, id) => rows.filter((r) => String(r.staffId) === String(id));
  const people = staff.map((s) => {
    const myCommission = mine(commission, s._id);
    return {
      staff: s,
      plans: mine(plans, s._id),
      attendance: mine(attendance, s._id),
      commission: {
        amount: myCommission.reduce((sum, e) => sum + e.amount, 0),
        sales: myCommission.reduce((sum, e) => sum + e.saleAmount, 0),
        count: myCommission.length,
      },
      paidServiceDays: bills.flatMap((b) => b.appointment.items.filter((i) => String(i.staffId) === String(s._id)).map(() => b.day)),
      unpaidServices: unpaid.flatMap((a) => a.items).filter((i) => String(i.staffId) === String(s._id)).length,
      adjustments: mine(adjustments, s._id),
      advances: mine(advances, s._id).filter((a) => advanceRepayment(a, month)),
    };
  });

  // Everyone working here, plus anyone who left but still has pay for this month
  const included = people.filter(
    (p) => p.staff.status === 'active' || p.plans.length > 0 || p.commission.count > 0 || p.adjustments.length > 0 || p.advances.length > 0
  );
  return { countUntil, people: included };
}

// Works the draft month out again from scratch. Refuses a locked month.
export async function calculateRun(ctx, month) {
  const branch = await activeBranch(ctx);
  const { countUntil, people } = await gatherMonth(ctx, branch, month);

  const results = people.map((p) => ({
    person: p,
    pay: calculateMonthlyPay({ month, countUntil, ...p, isActive: p.staff.status === 'active' }),
  }));

  const addUp = (rows) => ({
    count: rows.length,
    gross: rows.reduce((sum, r) => sum + r.pay.gross, 0),
    deductions: rows.reduce((sum, r) => sum + r.pay.deductions, 0),
    net: rows.reduce((sum, r) => sum + r.pay.net, 0),
    payable: rows.reduce((sum, r) => sum + Math.max(r.pay.net, 0), 0),
  });
  const totals = {
    ...addUp(results),
    frontDesk: addUp(results.filter((r) => r.person.staff.kind === 'FRONT_DESK')),
    commission: results.reduce((sum, r) => sum + r.person.commission.amount, 0),
    blocking: results.reduce((sum, r) => sum + r.pay.issues.filter((i) => i.blocking).length, 0),
    warnings: results.reduce((sum, r) => sum + r.pay.issues.filter((i) => !i.blocking).length, 0),
  };

  return mongoose.connection.transaction(async (session) => {
    // Bumping the version first means two people recalculating at once take turns
    const run = await PayrollRun.findOneAndUpdate(
      scoped(ctx, { branchId: branch._id, month }),
      { $setOnInsert: { orgId: ctx.orgId, branchId: branch._id, month, status: 'draft' }, $inc: { calculationVersion: 1 } },
      { upsert: true, returnDocument: 'after', session }
    );
    if (run.status === 'locked') throw new AppError(409, 'MONTH_LOCKED', `${monthName(month)} is locked and can’t change.`);

    await PayrollItem.deleteMany({ runId: run._id }, { session });
    await PayrollItem.create(
      results.map(({ person, pay }) => ({
        orgId: ctx.orgId,
        branchId: branch._id,
        runId: run._id,
        month,
        staffId: person.staff._id,
        staffName: person.staff.name,
        staffRole: person.staff.role,
        staffKind: person.staff.kind ?? 'SERVICE',
        ...pay,
      })),
      { session, ordered: true }
    );

    run.totals = totals;
    run.calculatedAt = new Date();
    await run.save({ session });
    return run;
  });
}

// The month for the selected branch: worked out on first open, and again when a draft is a few minutes old
export async function getRun(ctx, month) {
  const branch = await activeBranch(ctx);
  let run = await PayrollRun.findOne(scoped(ctx, { branchId: branch._id, month })).lean();
  const stale = run?.status === 'draft' && DateTime.fromJSDate(run.calculatedAt).diffNow('minutes').minutes < -STALE_AFTER_MINUTES;
  if (!run || stale) run = (await calculateRun(ctx, month)).toObject();

  const { end } = monthBounds(month);
  const today = todayInZone(branch.timezone);
  const [items, adjustments, payments, earlier] = await Promise.all([
    PayrollItem.find({ runId: run._id }).sort({ staffName: 1 }).lean(),
    PayrollAdjustment.find(scoped(ctx, { branchId: branch._id, month })).sort('createdAt').lean(),
    PayrollPayment.find({ runId: run._id }).sort({ paidOn: 1, createdAt: 1 }).lean(),
    PayrollRun.find(scoped(ctx, { branchId: branch._id, status: 'locked', month: { $lt: month } })).select('month totals.payable paidTotal').lean(),
  ]);

  // Salary still owed from earlier locked months, so it isn't forgotten
  const owedEarlier = earlier
    .map((r) => ({ month: r.month, owed: r.totals.payable - r.paidTotal }))
    .filter((r) => r.owed > 0)
    .sort((a, b) => a.month.localeCompare(b.month));

  return { run, items, adjustments, payments, owedEarlier, today, monthOver: today >= end, lastDay: end };
}

// Months already opened for this branch, newest first (for the month picker)
export function listRuns(ctx) {
  return PayrollRun.find(scoped(ctx, { branchId: ctx.activeBranchId }))
    .select('month status totals.net totals.blocking lockedAt')
    .sort({ month: -1 })
    .limit(24)
    .lean();
}

// A fingerprint of every amount, saved on lock so anyone can check later that nothing changed
function fingerprint(items) {
  const data = items.map((i) => [String(i.staffId), i.gross, i.deductions, i.net]).sort();
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// Lock the month: works it out one last time, refuses if anything blocking is left, then freezes it
export async function lockRun(ctx, month) {
  const branch = await activeBranch(ctx);
  const existing = await PayrollRun.findOne(scoped(ctx, { branchId: branch._id, month })).lean();
  if (existing?.status === 'locked') throw new AppError(409, 'MONTH_LOCKED', `${monthName(month)} is already locked.`);

  const { end } = monthBounds(month);
  if (todayInZone(branch.timezone) < end) {
    throw new AppError(409, 'MONTH_NOT_OVER', `${monthName(month)} can be locked from its last day (${DateTime.fromISO(end).toFormat('d LLL')}).`);
  }

  const run = await calculateRun(ctx, month);
  if (run.totals.blocking > 0) {
    throw new AppError(409, 'HAS_BLOCKING_ISSUES', `Sort out the ${run.totals.blocking} thing(s) to check before locking ${monthName(month)}.`);
  }
  const items = await PayrollItem.find({ runId: run._id }).lean();

  return mongoose.connection.transaction(async (session) => {
    // Only if nobody recalculated or locked it in the meantime
    const locked = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: 'draft', calculationVersion: run.calculationVersion },
      { $set: { status: 'locked', lockedAt: new Date(), lockedBy: ctx.userId, lockedByName: ctx.userName, totalsHash: fingerprint(items) } },
      { returnDocument: 'after', session }
    );
    if (!locked) throw new AppError(409, 'CHANGED', 'The payroll changed while you were locking it. Please check it again.');

    const people = items.length === 1 ? '1 person' : `${items.length} people`;
    const summary = `Locked ${monthName(month)} payroll for ${branch.name}: ${people}, ${formatAmount(run.totals.net)} to pay.`;
    await recordPayrollAction(ctx, { action: 'payroll.locked', branchId: branch._id, summary, after: { month, net: run.totals.net, count: items.length } }, session);
    return locked;
  });
}

// ---------------------------------------------------------------------------
// Bonuses and deductions
// ---------------------------------------------------------------------------

async function assertMonthOpen(ctx, branchId, month) {
  const run = await PayrollRun.findOne(scoped(ctx, { branchId, month })).select('status').lean();
  if (run?.status === 'locked') {
    throw new AppError(409, 'MONTH_LOCKED', `${monthName(month)} is locked. Add this to a later month as a correction instead.`);
  }
  return run;
}

// Work the month out again after a change, if it has been opened already
async function refreshIfOpened(ctx, run, month) {
  if (run) await calculateRun(ctx, month);
}

export async function addAdjustment(ctx, input) {
  const staff = await findStaff(ctx, input.staffId);
  if (String(staff.branchId) !== ctx.activeBranchId) throw new AppError(400, 'WRONG_BRANCH', `${staff.name} works at another branch.`);
  if (input.correctsMonth && input.correctsMonth >= input.month) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A correction must be for an earlier month');
  }
  const run = await assertMonthOpen(ctx, staff.branchId, input.month);

  const adjustment = await mongoose.connection.transaction(async (session) => {
    const [adjustment] = await PayrollAdjustment.create(
      [{ ...input, orgId: ctx.orgId, branchId: staff.branchId, staffId: staff._id, createdBy: ctx.userId, createdByName: ctx.userName }],
      { session }
    );
    const what = input.kind === 'bonus' ? 'a bonus' : 'a deduction';
    const fixes = input.correctsMonth ? `, correcting ${monthName(input.correctsMonth)}` : '';
    const summary = `Added ${what} of ${formatAmount(input.amount)} for ${staff.name} in ${monthName(input.month)}${fixes}. Reason: ${input.reason}`;
    await recordPayrollAction(ctx, { action: `payroll.${input.kind}_added`, branchId: staff.branchId, staffId: staff._id, summary, after: { month: input.month, kind: input.kind, amount: input.amount } }, session);
    return adjustment;
  });

  await refreshIfOpened(ctx, run, input.month);
  return adjustment;
}

export async function removeAdjustment(ctx, id) {
  const adjustment = await PayrollAdjustment.findOne(scoped(ctx, { _id: id })).lean();
  if (!adjustment || !ctx.allowedBranchIds.includes(String(adjustment.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bonus or deduction not found');
  const staff = await findStaff(ctx, adjustment.staffId);
  const run = await assertMonthOpen(ctx, adjustment.branchId, adjustment.month);

  await mongoose.connection.transaction(async (session) => {
    await PayrollAdjustment.deleteOne({ _id: adjustment._id }, { session });
    const summary = `Removed ${staff.name}'s ${adjustment.kind} of ${formatAmount(adjustment.amount)} in ${monthName(adjustment.month)} (“${adjustment.reason}”).`;
    await recordPayrollAction(ctx, { action: `payroll.${adjustment.kind}_removed`, branchId: adjustment.branchId, staffId: staff._id, summary, before: { month: adjustment.month, kind: adjustment.kind, amount: adjustment.amount } }, session);
  });

  await refreshIfOpened(ctx, run, adjustment.month);
}
