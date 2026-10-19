import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// Money a customer paid ahead, to be used on later bills at any branch of the salon.
// `remaining` only ever goes down with a guarded update, so an advance can never be used twice.
const customerAdvanceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }), // where it was taken
    customerId: ref('Customer', { required: true }),
    amount: money({ required: true, min: 1 }),
    remaining: money({ required: true }),
    // The payments it came from (one, or the extra part of a checkout payment)
    sources: [{ paymentId: ref('Payment'), amount: money(), _id: false }],
    fromInvoiceId: ref('Invoice', { default: null }), // set when it was the extra money paid at a checkout
    note: { type: String, trim: true },
    createdBy: ref('User'),
  },
  { timestamps: true, collection: 'customer_advances' }
);

customerAdvanceSchema.index({ orgId: 1, customerId: 1, createdAt: 1 });

export default mongoose.model('CustomerAdvance', customerAdvanceSchema);
