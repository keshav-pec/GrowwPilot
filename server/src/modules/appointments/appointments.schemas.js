import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';

// GET /api/availability?date=2026-09-28&staffId=...&duration=45
export const availabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  staffId: objectId,
  duration: z.coerce.number().int().min(5).max(480).optional(), // default: the branch's default duration
});
