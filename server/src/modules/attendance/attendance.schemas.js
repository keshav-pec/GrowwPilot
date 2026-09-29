import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../../config/constants.js';
import { objectId, time } from '../../utils/schemas.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalTime = z.union([time, z.literal(''), z.null()]).optional(); // '' or null = clear it

// GET /api/attendance?date=2026-09-28 (default: today at the branch)
export const listAttendanceSchema = z.object({ date: date.optional() });

// PUT /api/attendance: one staff member, one day. Times are branch-local "HH:mm".
export const markAttendanceSchema = z.object({
  staffId: objectId,
  date,
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: optionalTime,
  checkOut: optionalTime,
});

// GET /api/attendance/summary?month=2026-09
export const summarySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM') });
