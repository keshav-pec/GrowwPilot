import { z } from 'zod';
import { objectId, paise } from '../../utils/schemas.js';

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  category: z.string().trim().optional(),
  // Optional: null means "use the branch's default duration"
  durationMinutes: z.number().int().min(5, 'At least 5 minutes').max(480).nullable().optional(),
  price: paise,
  branchIds: z.array(objectId).optional(), // empty or missing = every branch
});

export const updateServiceSchema = createServiceSchema.partial();

export const serviceStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});
