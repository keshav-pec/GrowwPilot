import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PAY_MODELS } from '../config/constants.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// The pay parts. A plan only fills the parts its model uses; the rest stay null.
// Shared with PayChangeRequest, which holds a proposed plan.
export const payParts = {
  model: { type: String, enum: PAY_MODELS, required: true },
  monthlyBase: money({ default: null }), // paise per month
  dailyRate: money({ default: null }), // paise per day worked
  hourlyRate: money({ default: null }), // paise per hour worked
  assignmentRate: money({ default: null }), // paise per service done
  // Commission in basis points: 1000 = 10%, 1250 = 12.5%
  commissionBps: {
    type: Number,
    default: null,
    min: 0,
    max: 10000,
    validate: { validator: (v) => v === null || Number.isInteger(v), message: 'Commission must be whole basis points' },
  },
};

// How one staff member is paid from a start date. A change never edits an old plan's numbers:
// it closes the old plan the day before and starts a new one, so past pay can always be explained.
const payPlanSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    staffId: ref('Staff', { required: true }),
    ...payParts,
    // Branch-local days as text, like Attendance.date. effectiveTo null = no end date.
    effectiveFrom: { type: String, required: true, match: DATE_REGEX },
    effectiveTo: { type: String, default: null, match: DATE_REGEX },
    // Why it has an end date: 'replaced' by the next plan, or 'ended' by an owner (e.g. the person left)
    endReason: { type: String, enum: ['replaced', 'ended', null], default: null },
    note: { type: String, trim: true },
    createdBy: ref('User'),
    requestId: ref('PayChangeRequest'), // set when it came from an approved front desk request
  },
  { timestamps: true }
);

// Two plans can't start on the same day for the same person
payPlanSchema.index({ staffId: 1, effectiveFrom: 1 }, { unique: true });
payPlanSchema.index({ orgId: 1, staffId: 1 });

export default mongoose.model('PayPlan', payPlanSchema);
