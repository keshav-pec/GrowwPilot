import { Appointment, CustomerAdvance, Invoice, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';
import { moneyState } from '../billing/tax.rules.js';
import { recordInvoiceCommissions } from '../payroll/commission.service.js';

// What a customer has left in advances, oldest first (usable at any branch of the salon)
export async function advancesOf(ctx, customerId, session = null) {
  const advances = await CustomerAdvance.find({ orgId: ctx.orgId, customerId, remaining: { $gt: 0 } }).sort({ createdAt: 1 }).session(session).lean();
  return { advances, balance: advances.reduce((sum, a) => sum + a.remaining, 0) };
}

// Takes `amount` from the customer's advances (oldest first) for a bill. Each advance only ever goes down
// with a guarded update, so the same money can never be used twice, even from two desks at once.
async function useAdvances(ctx, invoice, amount, session) {
  const { advances, balance } = await advancesOf(ctx, invoice.customerId, session);
  if (balance < amount) throw new AppError(400, 'ADVANCE_TOO_LOW', `Only ${formatMoney(balance)} is left in advances`);
  let left = amount;
  for (const advance of advances) {
    if (left === 0) break;
    const take = Math.min(advance.remaining, left);
    const used = await CustomerAdvance.updateOne({ _id: advance._id, remaining: { $gte: take } }, { $inc: { remaining: -take } }, { session });
    if (used.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_CHANGED', 'That advance was just used on another bill. Please try again.');
    await PaymentAllocation.create([{ orgId: invoice.orgId, branchId: invoice.branchId, advanceId: advance._id, invoiceId: invoice._id, amount: take }], { session });
    left -= take;
  }
}

// Puts money on an issued bill, inside the caller's transaction. The only place a bill's amountPaid goes up.
//   - The bill is raised with a guarded update (only if at least this much is still due), so two desks paying
//     at the same moment can never pay more than the bill.
//   - Each payment is saved with an allocation saying which bill it paid; `advance` paise come from the
//     customer's advances instead.
//   - Money beyond what is due is refused, unless keepExtraAsAdvance: then it becomes a new advance for the customer.
//   - When the bill becomes fully paid (or costs nothing), the stylists earn their commission.
// payments: [{ method, amount, reference }]; source: 'CHECKOUT' | 'LATER'
// -> { invoice, advanceKept (paise) }
export async function applyPayments(ctx, invoice, payments, { session, source, timezone, advance = 0, keepExtraAsAdvance = false }) {
  const paying = payments.reduce((sum, p) => sum + p.amount, 0);
  const due = invoice.balanceDue;
  if (advance > 0 && !invoice.customerId) throw new AppError(400, 'VALIDATION_ERROR', 'Advances belong to a customer');
  if (advance > due) throw new AppError(400, 'OVERPAID', `Only ${formatMoney(due)} is due, so at most that much advance can be used`);

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
  if (advance > 0) await useAdvances(ctx, current, advance, session);

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
