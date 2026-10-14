import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Branch, EmployeeAdvance, Organization, PayrollItem, PayrollPayment, PayrollRun } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatAmount } from '../../utils/money.js';
import { todayInZone } from '../../utils/time.js';
import { findServiceStaff } from '../staff/staff.service.js';
import { recordPayrollAction } from './monthlyPayroll.service.js';
import { markPayrollStale } from './payrollStale.js';
import { advanceRepayment } from './monthlyPay.rules.js';

// Salary payments, payslips and advances. Owners only (branch owners: their branches).
// - Payments go against a LOCKED month, so they always match a final amount.
// - Paying more than is owed needs the business owner's override and a reason.
// - A wrong payment is cancelled with a reason; it is never edited or deleted.

const METHOD_LABEL = { CASH: 'cash', UPI: 'UPI', BANK: 'bank transfer' };
const monthName = (month) => DateTime.fromISO(`${month}-01`).toFormat('LLLL yyyy');

// One person's line in a month, at a branch this user may use
async function findItem(ctx, itemId) {
  const item = await PayrollItem.findOne(scoped(ctx, { _id: itemId })).lean();
  if (!item || !ctx.allowedBranchIds.includes(String(item.branchId))) throw new AppError(404, 'NOT_FOUND', 'Payroll line not found');
  return item;
}

// Paid so far (not counting cancelled payments)
async function paidSoFar(itemId, session) {
  const payments = await PayrollPayment.find({ itemId, status: 'recorded' }).select('amount').session(session ?? null).lean();
  return payments.reduce((sum, p) => sum + p.amount, 0);
}

export async function recordPayment(ctx, itemId, input, idempotencyKey) {
  // The same request sent twice (double click, network retry) gives back the first payment
  const repeat = await PayrollPayment.findOne(scoped(ctx, { idempotencyKey })).lean();
  if (repeat) return repeat;

  const item = await findItem(ctx, itemId);
  const branch = await Branch.findById(item.branchId).select('timezone').lean();
  if (input.paidOn > todayInZone(branch.timezone)) throw new AppError(400, 'VALIDATION_ERROR', 'The payment date can’t be in the future');
  if (input.allowOverpay && !ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can pay more than is owed');
  if (input.allowOverpay && !input.note) throw new AppError(400, 'VALIDATION_ERROR', 'Please say why you’re paying more than is owed');

  try {
    return await mongoose.connection.transaction(async (session) => {
      // Adding to the month's paid total first makes two payments at the same moment take turns,
      // so they can't both squeeze under the amount owed
      const run = await PayrollRun.findOneAndUpdate(
        { _id: item.runId, status: 'locked' },
        { $inc: { paidTotal: input.amount } },
        { returnDocument: 'after', session }
      );
      if (!run) throw new AppError(409, 'NOT_LOCKED', `Lock ${monthName(item.month)} before recording salary payments.`);

      const owed = Math.max(item.net, 0) - (await paidSoFar(item._id, session));
      const overpaid = input.amount > owed;
      if (overpaid && !input.allowOverpay) {
        throw new AppError(409, 'OVERPAYMENT', owed > 0 ? `Only ${formatAmount(owed)} is still owed to ${item.staffName}.` : `${item.staffName} has already been paid in full for ${monthName(item.month)}.`, { owed });
      }

      const [payment] = await PayrollPayment.create(
        [
          {
            orgId: ctx.orgId,
            branchId: item.branchId,
            runId: item.runId,
            itemId: item._id,
            staffId: item.staffId,
            staffName: item.staffName,
            month: item.month,
            ...input,
            overpaid,
            recordedBy: ctx.userId,
            recordedByName: ctx.userName,
            idempotencyKey,
          },
        ],
        { session }
      );

      const left = owed - input.amount;
      const status = left <= 0 ? 'paid in full' : `${formatAmount(left)} still owed`;
      const summary = `Paid ${item.staffName} ${formatAmount(input.amount)} by ${METHOD_LABEL[input.method]} for ${monthName(item.month)} (${status}).${overpaid ? ` More than owed: ${input.note}` : ''}`;
      await recordPayrollAction(ctx, { action: 'payroll.payment_recorded', branchId: item.branchId, staffId: item.staffId, summary, after: { month: item.month, amount: input.amount, method: input.method } }, session);
      return payment;
    });
  } catch (err) {
    if (err.code === 11000) return PayrollPayment.findOne(scoped(ctx, { idempotencyKey })).lean();
    throw err;
  }
}

export async function cancelPayment(ctx, paymentId, { reason }) {
  const payment = await PayrollPayment.findOne(scoped(ctx, { _id: paymentId })).lean();
  if (!payment || !ctx.allowedBranchIds.includes(String(payment.branchId))) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
  if (payment.status === 'cancelled') throw new AppError(409, 'ALREADY_CANCELLED', 'This payment was already cancelled');

  return mongoose.connection.transaction(async (session) => {
    const cancelled = await PayrollPayment.findOneAndUpdate(
      { _id: payment._id, status: 'recorded' },
      { $set: { status: 'cancelled', cancelledBy: ctx.userId, cancelledByName: ctx.userName, cancelledAt: new Date(), cancelReason: reason } },
      { returnDocument: 'after', session }
    );
    if (!cancelled) throw new AppError(409, 'ALREADY_CANCELLED', 'This payment was already cancelled');
    await PayrollRun.updateOne({ _id: payment.runId }, { $inc: { paidTotal: -payment.amount } }, { session });

    const summary = `Cancelled a payment of ${formatAmount(payment.amount)} to ${payment.staffName} for ${monthName(payment.month)} (paid ${DateTime.fromISO(payment.paidOn).toFormat('d LLL')}). Reason: ${reason}`;
    await recordPayrollAction(ctx, { action: 'payroll.payment_cancelled', branchId: payment.branchId, staffId: payment.staffId, summary, before: { month: payment.month, amount: payment.amount } }, session);
    return cancelled;
  });
}

// Everything the payslip PDF needs
export async function getPayslip(ctx, itemId) {
  const item = await findItem(ctx, itemId);
  const [run, branch, org, payments] = await Promise.all([
    PayrollRun.findById(item.runId).lean(),
    Branch.findById(item.branchId).select('name address city timezone').lean(),
    Organization.findById(ctx.orgId).select('name').lean(),
    PayrollPayment.find({ itemId: item._id, status: 'recorded' }).sort({ paidOn: 1 }).lean(),
  ]);
  return { item, run, branch, salonName: org.name, payments };
}

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------

async function lockedMonths(ctx, branchId) {
  const runs = await PayrollRun.find(scoped(ctx, { branchId, status: 'locked' })).select('month').lean();
  return new Set(runs.map((r) => r.month));
}

// One person's advances, with how much has been taken back in locked months so far
export async function listAdvances(ctx, staff) {
  const [advances, locked] = await Promise.all([
    EmployeeAdvance.find(scoped(ctx, { staffId: staff._id })).sort({ givenOn: -1 }).lean(),
    lockedMonths(ctx, staff.branchId),
  ]);
  return advances.map((a) => {
    const repaid = [...locked].reduce((sum, month) => sum + (advanceRepayment(a, month)?.amount ?? 0), 0);
    const count = Math.ceil(a.amount / a.monthlyRepayment);
    const lastMonth = DateTime.fromISO(`${a.firstMonth}-01`).plus({ months: count - 1 }).toFormat('yyyy-MM');
    return { ...a, repaid, balance: a.amount - repaid, repaymentCount: count, lastMonth };
  });
}

export async function giveAdvance(ctx, staffId, input, idempotencyKey) {
  const repeat = await EmployeeAdvance.findOne(scoped(ctx, { idempotencyKey })).lean();
  if (repeat) return repeat;

  const staff = await findServiceStaff(ctx, staffId);
  if (input.monthlyRepayment > input.amount) throw new AppError(400, 'VALIDATION_ERROR', 'The monthly repayment can’t be more than the advance');
  if (input.firstMonth < input.givenOn.slice(0, 7)) throw new AppError(400, 'VALIDATION_ERROR', 'Repayments can’t start before the advance is given');
  if ([...(await lockedMonths(ctx, staff.branchId))].some((m) => m >= input.firstMonth)) {
    throw new AppError(409, 'MONTH_LOCKED', `${monthName(input.firstMonth)} is already locked (or a later month is). Start repayments after the last locked month.`);
  }

  try {
    const advance = await mongoose.connection.transaction(async (session) => {
      const [advance] = await EmployeeAdvance.create(
        [{ ...input, orgId: ctx.orgId, branchId: staff.branchId, staffId: staff._id, idempotencyKey, createdBy: ctx.userId, createdByName: ctx.userName }],
        { session }
      );
      const summary = `Gave ${staff.name} an advance of ${formatAmount(input.amount)} by ${METHOD_LABEL[input.method]}, taken back ${formatAmount(input.monthlyRepayment)}/month from ${monthName(input.firstMonth)}. Reason: ${input.reason}`;
      await recordPayrollAction(ctx, { action: 'advance.given', branchId: staff.branchId, staffId: staff._id, summary, after: { month: input.firstMonth, amount: input.amount, monthlyRepayment: input.monthlyRepayment } }, session);
      return advance;
    });
    await markPayrollStale(ctx.orgId, staff.branchId);
    return advance;
  } catch (err) {
    if (err.code === 11000) return EmployeeAdvance.findOne(scoped(ctx, { idempotencyKey })).lean();
    throw err;
  }
}

// Stop taking repayments from a month on, e.g. the rest was paid back in cash
export async function closeAdvance(ctx, advanceId, { fromMonth, reason }) {
  const advance = await EmployeeAdvance.findOne(scoped(ctx, { _id: advanceId }));
  if (!advance || !ctx.allowedBranchIds.includes(String(advance.branchId))) throw new AppError(404, 'NOT_FOUND', 'Advance not found');
  const staff = await findServiceStaff(ctx, advance.staffId);
  if (advance.closedFromMonth) throw new AppError(409, 'ALREADY_CLOSED', 'This advance is already closed');
  // Locked months already took their repayment, so it can only stop after the last locked month
  if ([...(await lockedMonths(ctx, advance.branchId))].some((m) => m >= fromMonth)) {
    throw new AppError(409, 'MONTH_LOCKED', `${monthName(fromMonth)} is already locked (or a later month is). Choose a month after the last locked one.`);
  }

  await mongoose.connection.transaction(async (session) => {
    advance.closedFromMonth = fromMonth;
    advance.closeReason = reason;
    await advance.save({ session });
    const summary = `Stopped repayments of ${staff.name}'s ${formatAmount(advance.amount)} advance from ${monthName(fromMonth)}. Reason: ${reason}`;
    await recordPayrollAction(ctx, { action: 'advance.closed', branchId: advance.branchId, staffId: staff._id, summary, after: { month: fromMonth } }, session);
  });
  await markPayrollStale(ctx.orgId, advance.branchId);
}
