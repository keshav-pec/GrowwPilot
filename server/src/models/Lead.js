import mongoose from 'mongoose';
import { ref, phone } from './fields.js';
import { LEAD_SOURCES, LEAD_STATUSES } from '../config/constants.js';

// One entry in a lead's notes timeline
const noteSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  by: ref('User'),
  at: { type: Date, default: Date.now },
});

// A possible customer who enquired (Instagram, a phone call, ...) but hasn't booked yet.
const leadSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    name: { type: String, required: true, trim: true },
    phone: phone({ required: true }),
    source: { type: String, enum: LEAD_SOURCES, required: true },
    interestedServiceId: ref('Service'),
    assignedToUserId: ref('User'), // the owner or front desk user following up
    status: { type: String, enum: LEAD_STATUSES, default: 'NEW' },
    nextFollowUpAt: Date,
    notes: [noteSchema],
    // Filled in when the lead is converted into an appointment
    customerId: ref('Customer'),
    appointmentId: ref('Appointment'),
  },
  { timestamps: true }
);

leadSchema.index({ orgId: 1, status: 1 });
leadSchema.index({ orgId: 1, nextFollowUpAt: 1 });

export default mongoose.model('Lead', leadSchema);
