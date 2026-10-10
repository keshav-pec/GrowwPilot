import mongoose from 'mongoose';
import { ref } from './fields.js';

// A stylist or beautician. They don't log in; they are assigned to appointments.
// How they are paid lives in PayPlan (one row per pay setup, with a start date).
const staffSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    name: { type: String, required: true, trim: true },
    role: { type: String, default: 'Stylist', trim: true }, // Stylist, Beautician, ...
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

export default mongoose.model('Staff', staffSchema, 'staff'); // 3rd argument: collection name (otherwise "staffs")
