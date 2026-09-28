import { z } from 'zod';
import { objectId, paise } from '../../utils/schemas.js';

const serviceIds = z
  .array(objectId)
  .min(2, 'Choose at least 2 services')
  .refine((ids) => new Set(ids).size === ids.length, 'Each service can only be added once');

export const createComboSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  serviceIds,
  comboPrice: paise,
  branchIds: z.array(objectId).optional(), // empty or missing = every branch
});

export const updateComboSchema = createComboSchema.partial();

export const comboStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});
