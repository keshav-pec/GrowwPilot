import { z } from 'zod';
import { objectId } from '../../../utils/schemas.js';

const scope = z.enum(['salon', 'branch']);

const lineSchema = z.object({
  skuId: objectId,
  qty: z.number().int('Use a whole number').min(1, 'At least 1').nullable().optional(), // needed when it is taken per service
  deducts: z.boolean().default(true),
  useStoreIfNeeded: z.boolean().default(true),
});

// A new version of a service's recipe (salon-wide, or this branch only)
export const saveRecipeSchema = z.object({
  serviceId: objectId,
  scope,
  effectiveFrom: z.iso.datetime({ offset: true }).optional(), // default: now
  lines: z.array(lineSchema).max(20),
  note: z.string().trim().max(300).optional(),
});

export const endRecipeSchema = z.object({ serviceId: objectId, scope });
export const historySchema = z.object({ serviceId: objectId, scope });
