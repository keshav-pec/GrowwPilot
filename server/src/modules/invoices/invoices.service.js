import mongoose from 'mongoose';
import { Appointment, Branch, Counter, Invoice } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';

// ---------------------------------------------------------------------------
// The money rules (plan 4.5). Pure function, so it's easy to test and explain.
//   subtotal = the appointment's price (worked out by the server, never sent by the client)
//   discount = flat amount or a percentage, between 0 and the subtotal (so total can't go negative)
//   total    = subtotal - discount
//   payments = every amount > 0, and together they must equal the total exactly
// ---------------------------------------------------------------------------
export function calculateCheckout(subtotal, { discountType, discountValue, payments }) {
  let discount;
  if (discountType === 'percent') {
    if (discountValue > 100) throw new AppError(400, 'INVALID_DISCOUNT', 'A percentage discount can be at most 100%');
    discount = Math.round((subtotal * discountValue) / 100); // e.g. 10% of ₹1,530 = ₹153
  } else {
    if (!Number.isInteger(discountValue)) throw new AppError(400, 'INVALID_DISCOUNT', 'Discount must be in whole paise');
    discount = discountValue;
  }
  if (discount > subtotal) {
    throw new AppError(400, 'INVALID_DISCOUNT', `The discount can't be more than the bill (${formatMoney(subtotal)})`);
  }

  const total = subtotal - discount;
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  if (paid !== total) {
    const gap = total - paid;
    throw new AppError(
      400,
      'PAYMENT_MISMATCH',
      gap > 0 ? `Payments are ${formatMoney(gap)} short of the total ${formatMoney(total)}` : `Payments are ${formatMoney(-gap)} more than the total ${formatMoney(total)}`
    );
  }

  return { discount, total };
}

// "Andheri" -> "AND"
function branchCode(name) {
  return name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'BR';
}

// Checkout. One transaction saves the invoice, gives it the next number and marks the appointment paid.
export async function createInvoice(ctx, input) {
  const appointment = await Appointment.findOne(scoped(ctx, { _id: input.appointmentId })).lean();
  if (!appointment || !ctx.allowedBranchIds.includes(String(appointment.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Appointment not found');
  }
  if (appointment.status !== 'COMPLETED') throw new AppError(409, 'NOT_COMPLETED', 'Only completed appointments can be checked out');
  if (appointment.invoiceId) throw new AppError(409, 'ALREADY_PAID', 'This appointment has already been checked out');

  const subtotal = appointment.totalPrice; // from the database, not from the request
  const { discount, total } = calculateCheckout(subtotal, input);
  const branch = await Branch.findById(appointment.branchId).select('name').lean();

  try {
    return await mongoose.connection.transaction(async (session) => {
      // Next number for this branch (rolled back too if anything below fails)
      const counter = await Counter.findOneAndUpdate(
        { _id: `invoice:${branch._id}` },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, session }
      );

      const [invoice] = await Invoice.create(
        [
          {
            orgId: ctx.orgId,
            branchId: appointment.branchId,
            appointmentId: appointment._id,
            customerId: appointment.customerId,
            invoiceNumber: `GP-${branchCode(branch.name)}-${String(counter.seq).padStart(6, '0')}`,
            // A snapshot of what was done, so the invoice never changes later
            lines: appointment.items.map((i) => ({ serviceName: i.serviceName, staffName: i.staffName, price: i.price })),
            subtotal,
            discount,
            total,
            payments: input.payments,
            paidAt: new Date(),
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      // Mark the appointment paid, only if nobody else did in the meantime
      const marked = await Appointment.updateOne(
        scoped(ctx, { _id: appointment._id, status: 'COMPLETED', invoiceId: null }),
        { $set: { invoiceId: invoice._id } },
        { session }
      );
      if (marked.modifiedCount !== 1) throw new AppError(409, 'ALREADY_PAID', 'This appointment has already been checked out');

      return invoice;
    });
  } catch (err) {
    // The unique index on invoice.appointmentId is the final safety net against paying twice
    if (err.code === 11000) throw new AppError(409, 'ALREADY_PAID', 'This appointment has already been checked out');
    throw err;
  }
}

// One invoice with what the printable page needs
export async function getInvoice(ctx, id) {
  const invoice = await Invoice.findOne(scoped(ctx, { _id: id }))
    .populate('branchId', 'name address city timezone')
    .populate('customerId', 'name phone')
    .populate('appointmentId', 'startAt comboId')
    .lean();
  if (!invoice || !ctx.allowedBranchIds.includes(String(invoice.branchId._id))) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }
  return invoice;
}
