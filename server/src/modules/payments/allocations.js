import { Appointment, CustomerAdvance, Invoice, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';
import { moneyState } from '../billing/tax.rules.js';
import { recordInvoiceCommissions } from '../payroll/commission.service.js';
import { sourceOf } from './paymentSources.js';

export { advancesOf } from './paymentSources.js';

// Puts money on an issued bill, inside the caller's transaction. The only place a bill's amountPaid goes up.
//   - The bill is raised with a guarded update (only if at least this much is still due), so two desks paying
//     at the same moment can never pay more than the bill.
//   - Each payment is saved with an allocation saying which bill it paid. `sources` take money the customer
//     already has with the salon (see paymentSources.js): [{ type: 'ADVANCE', amount }]; `advance` is short for that.
//   - Money beyond what is due is refused, unless keepExtraAsAdvance: then it becomes a new advance for the customer.
//   - When the bill becomes fully paid (or costs nothing), the stylists earn their commission.
// payments: [{ method, amount, reference }]; source: 'CHECKOUT' | 'LATER'
// -> { invoice, advanceKept (paise) }
export async function applyPayments(ctx, invoice, payments, { session, source, timezone, advance = 0, sources = [], keepExtraAsAdvance = false }) {
  const fromSources = [...sources, ...(advance > 0 ? [{ type: 'ADVANCE', amount: advance }] : [])].filter((s) => s.amount > 0);
  for (const s of fromSources) sourceOf(s.type); // known kinds only
  advance = fromSources.reduce((sum, s) => sum + s.amount, 0); // everything paid from what the customer already has
  const paying = payments.reduce((sum, p) => sum + p.amount, 0);
  const due = invoice.balanceDue;
  if (advance > 0 && !invoice.customerId) throw new AppError(400, 'VALIDATION_ERROR', 'Only a customer’s own balance can pay a bill');
  if (advance > due) throw new AppError(400, 'OVERPAID', `Only ${formatMoney(due)} is due, so at most that much can come from the customer’s balance`);

  const toBill = Math.min(paying, due - advance);
  const extra = paying - toBill;
  if (extra > 0 && !keepExtraAsAdvance) {
    throw new AppError(
      400,
      'OVERPAID',
      source === 'CHECKOUT'
        ? `Payments are ${formatMoney(paying + advance - invoice.grandTotal)} more than the bill (${formatMoney(invoice.grandTotal)})`
        : due === 0
          ? 'This bill is already fully paid'
          : `Only ${formatMoney(due)} is due on this bill`
    );
  }
  if (extra > 0 && !invoice.customerId) throw new AppError(400, 'VALIDATION_ERROR', 'Extra money can only be kept as an advance for a customer');

  let current = invoice;
  const onBill = toBill + advance;
  if (onBill > 0) {
    current = await Invoice.findOneAndUpdate(
      { _id: invoice._id, orgId: invoice.orgId, status: 'ISSUED', balanceDue: { $gte: onBill } },
      { $inc: { amountPaid: onBill, balanceDue: -onBill, version: 1 } },
      { returnDocument: 'after', session }
    ).lean();
    if (!current) {
      const now = await Invoice.findById(invoice._id).select('status balanceDue').session(session).lean();
      if (now?.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can take payments');
      throw new AppError(400, 'OVERPAID', now.balanceDue === 0 ? 'This bill is already fully paid' : `Only ${formatMoney(now.balanceDue)} is due on this bill`);
    }
  }

  if (paying > 0) {
    const receivedAt = new Date();
    const saved = await Payment.insertMany(
      payments.map((p) => ({ orgId: invoice.orgId, branchId: invoice.branchId, customerId: invoice.customerId, method: p.method, amount: p.amount, reference: p.reference, receivedAt, recordedBy: ctx.userId, source })),
      { session }
    );
    // The bill takes the payments in order; anything beyond it goes to the new advance
    let leftForBill = toBill;
    const allocations = [];
    const sources = [];
    for (const p of saved) {
      const part = Math.min(p.amount, leftForBill);
      leftForBill -= part;
      if (part > 0) allocations.push({ orgId: invoice.orgId, branchId: invoice.branchId, paymentId: p._id, invoiceId: invoice._id, amount: part });
      if (p.amount > part) sources.push({ paymentId: p._id, amount: p.amount - part });
    }
    if (allocations.length > 0) await PaymentAllocation.insertMany(allocations, { session });
    if (extra > 0) {
      await CustomerAdvance.create(
        [{ orgId: invoice.orgId, branchId: invoice.branchId, customerId: invoice.customerId, amount: extra, remaining: extra, sources, fromInvoiceId: invoice._id, note: `Extra paid on bill ${invoice.invoiceNumber}`, createdBy: ctx.userId }],
        { session }
      );
    }
  }
  for (const s of fromSources) await sourceOf(s.type).take(ctx, current, s.amount, session);

  return { invoice: await settle(current, { session, timezone }), advanceKept: extra };
}

// Brings settlementStatus (Paid / Part paid / Unpaid) in line with the money on the bill. When it becomes
// fully paid, the stylists earn their commission; when it stops being fully paid, paidAt is cleared
// (the caller takes the commission back, see reverseCommissions).
export async function settle(invoice, { session, timezone }) {
  const status = moneyState(invoice).settlementStatus;
  if (status === invoice.settlementStatus) return invoice;

  const update = status === 'PAID' ? { $set: { settlementStatus: status, paidAt: new Date() } } : { $set: { settlementStatus: status }, $unset: { paidAt: '' } };
  const current = await Invoice.findOneAndUpdate({ _id: invoice._id }, update, { returnDocument: 'after', session }).lean();
  if (status === 'PAID' && current.appointmentId) {
    const appointment = await Appointment.findById(current.appointmentId).session(session).lean();
    await recordInvoiceCommissions({ invoice: current, appointment, timezone }, session);
  }
  return current;
}
