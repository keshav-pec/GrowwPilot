import { Branch, Invoice } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { present } from '../invoices/invoices.service.js';
import { applyPayments } from './allocations.js';

const METHOD_WORDS = { CASH: 'cash', UPI: 'UPI', CARD: 'card', OTHER: 'other' };

// "Record payment" on an issued bill that still has something due, e.g. the ₹680 left after a part payment.
// input: { invoiceId, payments: [{ method, amount, reference }] }
export async function recordPayments(ctx, { invoiceId, payments }, key) {
  const first = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).select('branchId status').lean();
  if (!first || !ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  if (first.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can take payments');

  const result = await runOnce(ctx, { key, operation: 'billing.payment.record' }, async (session) => {
    const invoice = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).session(session).lean();
    const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
    const updated = await applyPayments(ctx, invoice, payments, { session, source: 'LATER', timezone: branch.timezone });

    const amount = payments.reduce((sum, p) => sum + p.amount, 0);
    const how = payments.map((p) => `${formatMoney(p.amount)} ${METHOD_WORDS[p.method]}`).join(' + ');
    const left = updated.balanceDue === 0 ? 'now fully paid' : `${formatMoney(updated.balanceDue)} still due`;
    await logActivity(
      ctx,
      { action: 'billing.payment_recorded', branchId: invoice.branchId, summary: `Recorded ${formatMoney(amount)} (${how}) on bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}; ${left}`, after: { invoiceNumber: invoice.invoiceNumber, payments, balanceDue: updated.balanceDue } },
      session
    );
    return present(ctx, updated, { session });
  });

  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}
