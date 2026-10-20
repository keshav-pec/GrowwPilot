import { Branch, CustomerAdvance, Customer, Invoice, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { reverseCommissions } from '../payroll/commission.service.js';
import { moneyState } from '../billing/tax.rules.js';
import { billingPermissions, getBillingSettings } from '../billing/settings.service.js';
import { present } from '../invoices/invoices.service.js';
import { advancesOf, applyPayments, settle } from './allocations.js';

const METHOD_WORDS = { CASH: 'cash', UPI: 'UPI', CARD: 'card', OTHER: 'other' };
const describe = (payments) => payments.map((p) => `${formatMoney(p.amount)} ${METHOD_WORDS[p.method]}`).join(' + ');

// "Record payment" on an issued bill that still has something due, e.g. the ₹680 left after a part payment.
// input: { invoiceId, payments: [{ method, amount, reference }], useAdvance (paise), keepExtraAsAdvance }
export async function recordPayments(ctx, { invoiceId, payments, useAdvance = 0, sources = [], keepExtraAsAdvance = false }, key) {
  if (payments.length === 0 && !useAdvance && sources.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Add at least one payment');
  const first = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).select('branchId status').lean();
  if (!first || !ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  if (first.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can take payments');

  const result = await runOnce(ctx, { key, operation: 'billing.payment.record' }, async (session) => {
    const invoice = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).session(session).lean();
    const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
    const { invoice: updated, advanceKept } = await applyPayments(ctx, invoice, payments, { session, source: 'LATER', timezone: branch.timezone, advance: useAdvance, sources, keepExtraAsAdvance });

    const parts = [payments.length && describe(payments), useAdvance && `${formatMoney(useAdvance)} from advance`].filter(Boolean).join(' + ');
    const left = updated.balanceDue === 0 ? 'now fully paid' : `${formatMoney(updated.balanceDue)} still due`;
    const kept = advanceKept > 0 ? `; ${formatMoney(advanceKept)} kept as advance` : '';
    await logActivity(
      ctx,
      { action: 'billing.payment_recorded', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Recorded ${parts} on bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}; ${left}${kept}`, after: { invoiceNumber: invoice.invoiceNumber, payments, useAdvance, advanceKept, balanceDue: updated.balanceDue } },
      session
    );
    return present(ctx, updated, { session });
  });

  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// ---------------------------------------------------------------------------
// Reverse a payment that was recorded by mistake (owners, with a reason). The payment stays in the records,
// marked reversed. On a bill, the amount becomes due again (and commission earned on it is taken back);
// an advance payment can only be reversed while none of it has been used.
// ---------------------------------------------------------------------------
export async function reversePayment(ctx, paymentId, { reason }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).reversePayments) throw new AppError(403, 'FORBIDDEN', 'Only an owner can reverse a payment');
  if (!reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why the payment is reversed');
  const first = await Payment.findOne(scoped(ctx, { _id: paymentId, kind: 'RECEIPT' })).lean();
  if (!first || !ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Payment not found');

  const result = await runOnce(ctx, { key, operation: 'billing.payment.reverse' }, async (session) => {
    const payment = await Payment.findOne({ _id: first._id }).session(session).lean();
    if (payment.status !== 'VALID') throw new AppError(409, 'ALREADY_REVERSED', 'This payment has already been reversed');
    const branch = await Branch.findById(payment.branchId).select('timezone').session(session).lean();

    // Money that was kept as an advance: only while it is still all there
    const advance = await CustomerAdvance.findOne({ orgId: payment.orgId, 'sources.paymentId': payment._id }).session(session).lean();
    if (advance) {
      const part = advance.sources.find((s) => String(s.paymentId) === String(payment._id)).amount;
      const taken = await CustomerAdvance.updateOne({ _id: advance._id, remaining: { $gte: part } }, { $inc: { remaining: -part } }, { session });
      if (taken.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_USED', 'This advance has already been used on a bill, so the payment can’t be reversed');
    }

    let invoice = null;
    const allocations = await PaymentAllocation.find({ paymentId: payment._id, status: 'VALID' }).session(session).lean();
    for (const allocation of allocations) {
      const bill = await Invoice.findOne({ _id: allocation.invoiceId }).session(session).lean();
      const after = { ...bill, amountPaid: bill.amountPaid - allocation.amount };
      if (moneyState(after).netPaid < 0) throw new AppError(409, 'ALREADY_REFUNDED', 'Money from this payment has already been refunded, so it can’t be reversed');
      const updated = await Invoice.findOneAndUpdate(
        { _id: bill._id, version: bill.version },
        { $inc: { amountPaid: -allocation.amount, version: 1 }, $set: { balanceDue: moneyState(after).balanceDue } },
        { returnDocument: 'after', session }
      ).lean();
      if (!updated) throw new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please try again.');
      await PaymentAllocation.updateOne({ _id: allocation._id }, { $set: { status: 'REVERSED' } }, { session });
      invoice = await settle(updated, { session, timezone: branch.timezone });
      // It was fully paid and isn't any more: the stylists' commission on it is taken back (it comes back when paid again)
      if (bill.settlementStatus === 'PAID' && invoice.settlementStatus !== 'PAID') {
        await reverseCommissions({ invoice, eventKey: `payment_reversed:${payment._id}`, day: todayInZone(branch.timezone) }, session);
      }
    }

    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'REVERSED', reversal: { at: new Date(), by: ctx.userId, byName: ctx.userName, reason: reason.trim() } } }, { session });
    const where = invoice ? `bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}` : 'an advance';
    await logActivity(
      ctx,
      { action: 'billing.payment_reversed', branchId: payment.branchId, invoiceId: invoice?._id, summary: `Reversed ${formatMoney(payment.amount)} (${METHOD_WORDS[payment.method]}) on ${where}: ${reason.trim()}`, before: { status: 'VALID' }, after: { status: 'REVERSED', reason: reason.trim(), balanceDue: invoice?.balanceDue } },
      session
    );
    return invoice ? { invoice: await present(ctx, invoice, { session, settings }) } : { invoice: null };
  });
  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// ---------------------------------------------------------------------------
// Customer advances: money paid ahead, used on later bills at any branch.
// ---------------------------------------------------------------------------
export async function takeAdvance(ctx, { customerId, method, amount, reference, note }, key) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('name').lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const branchId = ctx.activeBranchId;

  return runOnce(ctx, { key, operation: 'billing.advance.take' }, async (session) => {
    const [payment] = await Payment.create([{ orgId: ctx.orgId, branchId, customerId, method, amount, reference, recordedBy: ctx.userId, source: 'ADVANCE' }], { session });
    await CustomerAdvance.create([{ orgId: ctx.orgId, branchId, customerId, amount, remaining: amount, sources: [{ paymentId: payment._id, amount }], note: note?.trim() || undefined, createdBy: ctx.userId }], { session });
    await logActivity(ctx, { action: 'billing.advance_taken', branchId, summary: `Took an advance of ${formatMoney(amount)} (${METHOD_WORDS[method]}) from ${customer.name}${note?.trim() ? `: ${note.trim()}` : ''}` }, session);
    return customerAdvances(ctx, customerId, session);
  });
}

// A customer's advances: what's left, and each advance with the bills it paid
export async function customerAdvances(ctx, customerId, session = null) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('_id').session(session).lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const advances = await CustomerAdvance.find(scoped(ctx, { customerId })).sort({ createdAt: -1 }).populate('branchId', 'name').populate('createdBy', 'name').session(session).lean();
  const uses = await PaymentAllocation.find({ advanceId: { $in: advances.map((a) => a._id) }, status: 'VALID' }).populate('invoiceId', 'invoiceNumber').session(session).lean();
  const reversed = await Payment.find({ _id: { $in: advances.flatMap((a) => a.sources.map((s) => s.paymentId)) }, status: 'REVERSED' }).select('_id').session(session).lean();
  const isReversed = (a) => a.sources.length > 0 && a.sources.every((s) => reversed.some((p) => String(p._id) === String(s.paymentId)));
  return {
    balance: (await advancesOf(ctx, customerId, session)).balance,
    advances: advances.map((a) => ({
      ...a,
      reversed: isReversed(a), // the payment it came from was reversed: nothing left to use
      uses: uses.filter((u) => String(u.advanceId) === String(a._id)).map((u) => ({ invoiceId: u.invoiceId?._id, invoiceNumber: u.invoiceId?.invoiceNumber, amount: u.amount, at: u.createdAt })),
    })),
  };
}
