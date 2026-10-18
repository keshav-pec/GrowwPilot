import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PAYMENT_METHODS } from '../config/constants.js';

// Money a customer handed over, e.g. ₹500 by UPI. Which bill it pays is in PaymentAllocation,
// so one payment could later pay several bills, or sit as an advance (Phase 2).
// Card numbers are never stored: only the method and an optional reference (UPI id, last 4 digits...).
const paymentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    customerId: ref('Customer', { default: null }),
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: money({ required: true, min: 1 }),
    reference: { type: String, trim: true },
    receivedAt: { type: Date, default: Date.now },
    recordedBy: ref('User'),
    // CHECKOUT = taken while issuing the bill, LATER = "Record payment" on a bill, MIGRATED = from a bill made before payments had their own records
    source: { type: String, enum: ['CHECKOUT', 'LATER', 'MIGRATED'], required: true },
    verificationStatus: { type: String, enum: ['RECORDED'], default: 'RECORDED' }, // no payment gateway: the desk records what it received
    status: { type: String, enum: ['VALID', 'REVERSED'], default: 'VALID' }, // reversals come in Phase 2
  },
  { timestamps: true }
);

paymentSchema.index({ orgId: 1, branchId: 1, receivedAt: 1 }); // collections by day and method

export default mongoose.model('Payment', paymentSchema);
