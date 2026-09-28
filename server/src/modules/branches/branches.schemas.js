import { z } from 'zod';
import { time, timezone } from '../../utils/schemas.js';

const branchFields = z.object({
  name: z.string().trim().min(2, 'Branch name is required'),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  timezone,
  openTime: time,
  closeTime: time,
  defaultServiceMinutes: z.number().int().min(5, 'At least 5 minutes').max(480),
});

// "09:00" < "21:00" works as plain text comparison because both are HH:mm
export const createBranchSchema = branchFields.refine((b) => b.openTime < b.closeTime, {
  message: 'Closing time must be after opening time',
  path: ['closeTime'],
});

// Editing: every field is optional (only send what changed). The service re-checks the hours.
export const updateBranchSchema = branchFields.partial();

export const branchStatusSchema = z.object({
  status: z.enum(['active', 'archived']),
});
