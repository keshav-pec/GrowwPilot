import mongoose from 'mongoose';
import { ref } from './fields.js';
import { STAFF_KINDS } from '../config/constants.js';

// A team member who gets paid. Stylists and beauticians (kind SERVICE) don't log in and are
// assigned to appointments. Front desk members (kind FRONT_DESK) are never booked; they can be
// linked to their front desk login (userId).
// How they are paid lives in PayPlan (one row per pay setup, with a start date).
const staffSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: STAFF_KINDS, default: 'SERVICE' },
    role: { type: String, default: 'Stylist', trim: true }, // Stylist, Beautician, Receptionist, ...
    userId: ref('User', { default: null }), // front desk only: their login account
    phone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },

    // Bumped inside every booking transaction. Two bookings for the same stylist
    // at the same moment both try to change this, so one of them has to wait/retry (plan 4.1).
    scheduleVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

staffSchema.index({ orgId: 1, branchId: 1 });
// One login can be linked to only one team member
staffSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });

export default mongoose.model('Staff', staffSchema, 'staff'); // 3rd argument: collection name (otherwise "staffs")
