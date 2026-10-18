import { z } from 'zod';
import { objectId, paise } from '../../utils/schemas.js';
import { GST_RATES_BPS } from '../../config/billing.js';

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  category: z.string().trim().optional(),
  // Optional: null means "use the branch's default duration"
  durationMinutes: z.number().int().min(5, 'At least 5 minutes').max(480).nullable().optional(),
  price: paise,
  branchIds: z.array(objectId).optional(), // empty or missing = every branch
  // GST: null / empty = use the salon's default (Billing settings)
  taxRateBps: z.number().int().refine((v) => GST_RATES_BPS.includes(v), 'Choose a GST rate from the list').nullable().optional(),
  sacCode: z.string().trim().regex(/^(\d{4,8})?$/, 'SAC code is 4 to 8 digits').optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export const serviceStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});
