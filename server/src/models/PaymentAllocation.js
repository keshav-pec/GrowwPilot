import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// "This much of that payment (or of the customer's advance) went to this bill". The bill's amountPaid is the sum
// of its valid allocations, and is only ever raised with a guarded update, so two desks can never pay more than the bill.
const paymentAllocationSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    paymentId: ref('Payment', { default: null }), // money taken now...
    advanceId: ref('CustomerAdvance', { default: null }), // ...or money the customer paid earlier
    invoiceId: ref('Invoice', { required: true }),
    amount: money({ required: true, min: 1 }),
    status: { type: String, enum: ['VALID', 'REVERSED'], default: 'VALID' },
  },
  { timestamps: true, collection: 'payment_allocations' }
);

paymentAllocationSchema.index({ invoiceId: 1 });
paymentAllocationSchema.index({ paymentId: 1 });

export default mongoose.model('PaymentAllocation', paymentAllocationSchema);
