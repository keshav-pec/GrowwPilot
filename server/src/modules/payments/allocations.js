import { Appointment, Invoice, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { formatMoney } from '../../utils/money.js';
import { settlementStatus } from '../billing/tax.rules.js';
import { recordInvoiceCommissions } from '../payroll/commission.service.js';

// Puts payments on an issued bill, inside the caller's transaction. The only place a bill's amountPaid goes up.
//   - The bill is raised with a guarded update (only if at least this much is still due), so two desks paying
//     at the same moment can never pay more than the bill.
//   - Each payment is saved with an allocation saying which bill it paid.
//   - When the bill becomes fully paid (or costs nothing), the stylists earn their commission.
// payments: [{ method, amount, reference }]; source: 'CHECKOUT' | 'LATER'
export async function applyPayments(ctx, invoice, payments, { session, source, timezone }) {
  const amount = payments.reduce((sum, p) => sum + p.amount, 0);
  let current = invoice;

  if (amount > 0) {
    current = await Invoice.findOneAndUpdate(
      { _id: invoice._id, orgId: invoice.orgId, status: 'ISSUED', balanceDue: { $gte: amount } },
      { $inc: { amountPaid: amount, balanceDue: -amount, version: 1 } },
      { returnDocument: 'after', session }
    ).lean();
    if (!current) {
      const now = await Invoice.findById(invoice._id).select('status balanceDue').session(session).lean();
      if (now?.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can take payments');
      throw new AppError(400, 'OVERPAID', now.balanceDue === 0 ? 'This bill is already fully paid' : `Only ${formatMoney(now.balanceDue)} is due on this bill`);
    }

    const receivedAt = new Date();
    const saved = await Payment.insertMany(
      payments.map((p) => ({ orgId: invoice.orgId, branchId: invoice.branchId, customerId: invoice.customerId, method: p.method, amount: p.amount, reference: p.reference, receivedAt, recordedBy: ctx.userId, source })),
      { session }
    );
    await PaymentAllocation.insertMany(
      saved.map((p) => ({ orgId: invoice.orgId, branchId: invoice.branchId, paymentId: p._id, invoiceId: invoice._id, amount: p.amount })),
      { session }
    );
  }

  const status = settlementStatus(current.amountPaid, current.grandTotal);
  if (status === current.settlementStatus) return current;

  const set = { settlementStatus: status };
  if (status === 'PAID') set.paidAt = new Date();
  current = await Invoice.findOneAndUpdate({ _id: invoice._id }, { $set: set }, { returnDocument: 'after', session }).lean();

  if (status === 'PAID' && current.appointmentId) {
    const appointment = await Appointment.findById(current.appointmentId).session(session).lean();
    await recordInvoiceCommissions({ invoice: current, appointment, timezone }, session);
  }
  return current;
}
