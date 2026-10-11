import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// A bonus or deduction an owner adds to someone's pay for a month, always with a reason.
// A correction for a month that is already locked goes into a later month, noting which month it fixes.
const payrollAdjustmentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    staffId: ref('Staff', { required: true }),
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    kind: { type: String, enum: ['bonus', 'deduction'], required: true },
    amount: money({ required: true, min: 1 }),
    reason: { type: String, required: true, trim: true },
    correctsMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    createdBy: ref('User', { required: true }),
    createdByName: { type: String, required: true },
  },
  { timestamps: true }
);

payrollAdjustmentSchema.index({ orgId: 1, branchId: 1, month: 1 });

export default mongoose.model('PayrollAdjustment', payrollAdjustmentSchema, 'payroll_adjustments');
