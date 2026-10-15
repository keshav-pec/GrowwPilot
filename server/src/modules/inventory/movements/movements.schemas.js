import { z } from 'zod';
import { WRITE_OFF_REASONS } from '../../../config/inventory.js';
import { objectId } from '../../../utils/schemas.js';

const note = z.string().trim().max(300).optional().transform((v) => v || undefined);

// Use, write-off or count correction, from a store (locationId) or a hand-out (allocationId)
export const writeOffSchema = z
  .object({
    skuId: objectId,
    locationId: objectId.optional(),
    allocationId: objectId.optional(),
    qty: z.number().int('Use a whole number').min(1, 'At least 1'),
    reason: z.enum(WRITE_OFF_REASONS),
    direction: z.enum(['REMOVE', 'ADD']).default('REMOVE'),
    note,
    reportId: objectId.optional(), // the front desk's problem report this deals with
  })
  .refine((w) => Boolean(w.locationId) !== Boolean(w.allocationId), { message: 'Choose a store or a hand-out', path: ['locationId'] });

export const correctSchema = z.object({ note: z.string().trim().min(3, 'Say what went wrong').max(300) });
