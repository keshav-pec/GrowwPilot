import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { SALARY_PAYMENT_METHODS } from '../config/constants.js';

// Money actually handed over for one person's pay in a locked month (full or part).
// Never edited or deleted: a mistake is cancelled with a reason, and the record stays.
const payrollPaymentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    runId: ref('PayrollRun', { required: true }),
    itemId: ref('PayrollItem', { required: true }),
    staffId: ref('Staff', { required: true }),
    staffName: { type: String, required: true },
    month: { type: String, required: true },
    amount: money({ required: true, min: 1 }),
    method: { type: String, enum: SALARY_PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true }, // UPI or bank transaction id
    paidOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    note: { type: String, trim: true },
    overpaid: { type: Boolean, default: false }, // the business owner allowed paying more than owed
    recordedBy: ref('User', { required: true }),
    recordedByName: { type: String, required: true },
    // Sent by the screen with each new payment, so a double click or retry records it only once
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: ['recorded', 'cancelled'], default: 'recorded' },
    cancelledBy: ref('User'),
    cancelledByName: String,
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true }
);

payrollPaymentSchema.index({ orgId: 1, idempotencyKey: 1 }, { unique: true });
payrollPaymentSchema.index({ itemId: 1 });

export default mongoose.model('PayrollPayment', payrollPaymentSchema, 'payroll_payments');
