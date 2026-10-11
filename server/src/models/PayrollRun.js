import mongoose from 'mongoose';
import { ref, money } from './fields.js';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// One month of payroll for one branch. A draft is worked out again whenever its numbers change;
// once locked, it never changes (corrections go into a later month as adjustments).
const payrollRunSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    month: { type: String, required: true, match: MONTH_REGEX }, // "2026-10"
    status: { type: String, enum: ['draft', 'locked'], default: 'draft' },
    calculationVersion: { type: Number, default: 0 }, // +1 every time the draft is worked out again
    calculatedAt: Date,
    totals: {
      count: { type: Number, default: 0 },
      gross: money({ default: 0 }),
      deductions: money({ default: 0 }),
      net: { type: Number, default: 0 }, // can be below zero, which blocks locking
      commission: money({ default: 0 }),
      blocking: { type: Number, default: 0 }, // "things to check" that stop the lock
      warnings: { type: Number, default: 0 },
    },
    lockedAt: Date,
    lockedBy: ref('User'),
    lockedByName: String,
    totalsHash: String, // fingerprint of the locked amounts, to prove they never changed
  },
  { timestamps: true }
);

payrollRunSchema.index({ branchId: 1, month: 1 }, { unique: true });
payrollRunSchema.index({ orgId: 1, branchId: 1, month: -1 });

export default mongoose.model('PayrollRun', payrollRunSchema, 'payroll_runs');
