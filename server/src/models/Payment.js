import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PAYMENT_METHODS } from '../config/constants.js';

// Money a customer handed over (RECEIPT), e.g. ₹500 by UPI, or money handed back (REFUND).
// Which bill a receipt pays is in PaymentAllocation; money kept for later is a CustomerAdvance.
// Card numbers are never stored: only the method and an optional reference (UPI id, last 4 digits...).
const paymentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    customerId: ref('Customer', { default: null }),
    kind: { type: String, enum: ['RECEIPT', 'REFUND'], default: 'RECEIPT' }, // the amount is always positive
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: money({ required: true, min: 1 }),
    reference: { type: String, trim: true },
    receivedAt: { type: Date, default: Date.now },
    recordedBy: ref('User'),
    // CHECKOUT = taken while issuing the bill, LATER = "Record payment" on a bill, ADVANCE = an advance taken on the customer,
    // REFUND = money given back, MIGRATED = from a bill made before payments had their own records
    source: { type: String, enum: ['CHECKOUT', 'LATER', 'ADVANCE', 'REFUND', 'MIGRATED'], required: true },
    refundId: ref('Refund', { default: null }),
    verificationStatus: { type: String, enum: ['RECORDED'], default: 'RECORDED' }, // no payment gateway: the desk records what it received
    status: { type: String, enum: ['VALID', 'REVERSED'], default: 'VALID' },
    reversal: { at: Date, by: ref('User'), byName: String, reason: String }, // an owner undid a wrongly recorded payment
  },
  { timestamps: true }
);

paymentSchema.index({ orgId: 1, branchId: 1, receivedAt: 1 }); // collections by day and method

export default mongoose.model('Payment', paymentSchema);
