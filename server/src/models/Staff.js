import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// A stylist or beautician. They don't log in; they are assigned to appointments.
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

    // Reserved for the future salary module (not used yet)
    salary: {
      monthlyBase: money(),
      commissionPercent: { type: Number, min: 0, max: 100 },
    },
  },
  { timestamps: true }
);

staffSchema.index({ orgId: 1, branchId: 1 });

export default mongoose.model('Staff', staffSchema, 'staff'); // 3rd argument: collection name (otherwise "staffs")
