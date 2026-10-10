import mongoose from 'mongoose';
import { ref } from './fields.js';
import { payParts } from './PayPlan.js';
import { PAY_REQUEST_STATUSES } from '../config/constants.js';

// A pay change asked for by the front desk. It only becomes a PayPlan when an owner approves it.
const payChangeRequestSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }), // the staff member's branch: decides which owners can approve
    staffId: ref('Staff', { required: true }),
    staffName: { type: String, required: true },
    proposed: {
      ...payParts,
      effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    },
    currentSummary: String, // how they were paid when the request was made, in words
    note: { type: String, required: true, trim: true }, // the front desk's reason
    status: { type: String, enum: PAY_REQUEST_STATUSES, default: 'pending' },
    requestedBy: ref('User', { required: true }),
    requestedByName: { type: String, required: true },
    decidedBy: ref('User'),
    decidedByName: String,
    decidedAt: Date,
    decisionNote: { type: String, trim: true },
    planId: ref('PayPlan'), // the plan created on approval
  },
  { timestamps: true }
);

// Only one open request per staff member at a time
payChangeRequestSchema.index({ staffId: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
payChangeRequestSchema.index({ orgId: 1, branchId: 1, status: 1, createdAt: -1 });

export default mongoose.model('PayChangeRequest', payChangeRequestSchema);
