import mongoose from 'mongoose';
import { ref } from './fields.js';
import { ATTENDANCE_STATUSES } from '../config/constants.js';

// One row per staff member per day.
const attendanceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    staffId: ref('Staff', { required: true }),
    // The branch-local day as text, e.g. "2026-09-28". Text avoids timezone mix-ups for a plain date.
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    checkInAt: Date,
    checkOutAt: Date,
    markedBy: ref('User'),
  },
  { timestamps: true }
);

// A staff member can only have one attendance record per day
attendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);
