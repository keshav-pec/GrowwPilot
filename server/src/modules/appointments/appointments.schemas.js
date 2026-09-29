import { z } from 'zod';
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from '../../config/constants.js';
import { objectId, time } from '../../utils/schemas.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// GET /api/availability?date=2026-09-28&staffId=...&duration=45
export const availabilitySchema = z.object({
  date,
  staffId: objectId,
  duration: z.coerce.number().int().min(5).max(480).optional(), // default: the branch's default duration
  excludeAppointmentId: objectId.optional(), // when rescheduling: its own current slot counts as free
});

// One service in the booking, with the stylist doing it and an optional custom duration
const itemSchema = z.object({
  serviceId: objectId,
  staffId: objectId,
  durationMinutes: z.number().int().min(5).max(480).optional(),
});

// The branch is NOT sent: the server uses the branch picked in the branch switcher (req.ctx)
export const createAppointmentSchema = z.object({
  customerId: objectId,
  date, // branch-local date, e.g. "2026-09-28"
  startTime: time, // branch-local time, e.g. "14:30"
  items: z.array(itemSchema).min(1, 'Choose at least one service').max(10),
  comboId: objectId.optional(),
  source: z.enum(APPOINTMENT_SOURCES).default('phone'),
  notes: z.string().trim().max(1000).optional(),
});

// Edit / reschedule: same fields, but the customer and source stay as they were
export const updateAppointmentSchema = createAppointmentSchema.omit({ customerId: true, source: true });

export const listAppointmentsSchema = z.object({
  date: date.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  staffId: objectId.optional(),
  search: z.string().trim().optional(), // customer name or phone
});

export const appointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  reason: z.string().trim().max(500).optional(), // e.g. why it was cancelled
});
