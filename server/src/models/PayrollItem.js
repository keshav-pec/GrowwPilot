import mongoose from 'mongoose';
import { appendOnly, ref, money } from './fields.js';
import { STAFF_KINDS } from '../config/constants.js';

// One line of a payslip, e.g. { kind: 'salary', label: 'Monthly salary', detail: 'Full month', amount: 2000000 }
const lineSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['salary', 'daily', 'hourly', 'per_service', 'commission', 'bonus', 'deduction', 'advance'], required: true },
    label: { type: String, required: true },
    detail: String,
    amount: money({ required: true }), // always positive; deductions and advance repayments are taken away
  },
  { _id: false }
);

// Something an owner should look at. Blocking ones stop the month from being locked.
const issueSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    blocking: { type: Boolean, default: false },
  },
  { _id: false }
);

// One person's pay for one month: a frozen snapshot of how it was worked out.
// A draft month replaces its items when it is worked out again; items are never edited in place.
const payrollItemSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    runId: ref('PayrollRun', { required: true }),
    month: { type: String, required: true },
    staffId: ref('Staff', { required: true }),
    staffName: { type: String, required: true },
    staffRole: String,
    staffKind: { type: String, enum: STAFF_KINDS, default: 'SERVICE' }, // which section of the payroll they show in
    payDescription: String, // how they were paid this month, in words
    lines: [lineSchema],
    notes: [String], // facts that don't change the pay, e.g. "2 days absent (not taken off automatically)"
    issues: [issueSchema],
    gross: money({ required: true }),
    deductions: money({ required: true }),
    net: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

payrollItemSchema.index({ runId: 1, staffId: 1 }, { unique: true });

appendOnly(payrollItemSchema, 'Payroll items');

export default mongoose.model('PayrollItem', payrollItemSchema, 'payroll_items');
