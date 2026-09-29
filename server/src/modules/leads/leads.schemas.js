import { z } from 'zod';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../config/constants.js';
import { objectId, time } from '../../utils/schemas.js';
import { normalizePhone, PHONE_REGEX } from '../../utils/phone.js';

const phone = z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_REGEX, 'Enter a valid 10-digit mobile number'));
const optionalId = z.union([z.literal(''), objectId]); // '' = none
const followUp = z.iso.datetime('Choose a valid date and time').nullable(); // UTC, e.g. "2026-09-30T05:30:00.000Z"

export const listLeadsSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  assignedTo: objectId.optional(),
  search: z.string().trim().optional(), // name or phone
  overdue: z.literal('true').optional(), // only open leads whose follow-up time has passed
});

export const createLeadSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone,
  source: z.enum(LEAD_SOURCES),
  interestedServiceId: optionalId.optional(),
  assignedToUserId: optionalId.optional(),
  nextFollowUpAt: followUp.optional(),
  note: z.string().trim().max(1000).optional(), // first note on the timeline
});

// Status and notes have their own endpoints, so they aren't edited here
export const updateLeadSchema = createLeadSchema.omit({ note: true }).partial();

export const leadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
});

export const leadNoteSchema = z.object({
  text: z.string().trim().min(1, 'Write a note').max(1000),
});

// Same booking fields as a normal appointment; the customer comes from the lead's phone
export const convertLeadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  startTime: time,
  items: z
    .array(z.object({ serviceId: objectId, staffId: objectId, durationMinutes: z.number().int().min(5).max(480).optional() }))
    .min(1, 'Choose at least one service')
    .max(10),
  comboId: objectId.optional(),
  notes: z.string().trim().max(1000).optional(),
});
