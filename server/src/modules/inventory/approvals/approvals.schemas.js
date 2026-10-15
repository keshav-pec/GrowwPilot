import { z } from 'zod';
import { WRITE_OFF_REASONS } from '../../../config/inventory.js';
import { objectId } from '../../../utils/schemas.js';

// The front desk reports what happened; they can't change stock themselves
export const reportSchema = z.object({
  skuId: objectId,
  allocationId: objectId.optional(),
  locationId: objectId.optional(),
  reason: z.enum([...WRITE_OFF_REASONS.filter((r) => r !== 'DIRECT_USE'), 'OTHER']),
  qty: z.number().int().min(1).optional(),
  note: z.string().trim().min(3, 'Say what happened').max(300),
});

export const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() });
export const dismissSchema = z.object({ note: z.string().trim().min(3, 'Say why').max(300) });
