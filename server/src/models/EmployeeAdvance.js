import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { SALARY_PAYMENT_METHODS } from '../config/constants.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Money given to someone now, taken back from their pay in fixed monthly amounts.
// The schedule is fixed when it's given (e.g. ₹10,000 at ₹2,000/month from Nov), so every month's
// repayment can always be worked out the same way. Closing it stops repayments from a month onwards.
const employeeAdvanceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    staffId: ref('Staff', { required: true }),
    amount: money({ required: true, min: 1 }),
    givenOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    method: { type: String, enum: SALARY_PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true },
    reason: { type: String, required: true, trim: true },
    monthlyRepayment: money({ required: true, min: 1 }),
    firstMonth: { type: String, required: true, match: MONTH }, // first month it is taken off pay
    closedFromMonth: { type: String, match: MONTH, default: null }, // no repayments from this month on
    closeReason: String,
    idempotencyKey: { type: String, required: true }, // a double click or retry records it only once
    createdBy: ref('User', { required: true }),
    createdByName: { type: String, required: true },
  },
  { timestamps: true }
);

employeeAdvanceSchema.index({ orgId: 1, staffId: 1 });
employeeAdvanceSchema.index({ orgId: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.model('EmployeeAdvance', employeeAdvanceSchema, 'employee_advances');
