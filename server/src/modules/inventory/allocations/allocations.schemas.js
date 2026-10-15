import { z } from 'zod';
import { RECIPIENT_KINDS } from '../../../config/inventory.js';
import { objectId } from '../../../utils/schemas.js';

const qty = z.number().int('Use a whole number').min(1, 'At least 1');
const note = z.string().trim().max(300).optional().transform((v) => v || undefined);

// Who gets it: the salon floor, a station or a team member
export const recipientSchema = z
  .object({ kind: z.enum(RECIPIENT_KINDS), id: objectId.optional() })
  .refine((r) => r.kind === 'FLOOR' || r.id, { message: 'Choose who gets it', path: ['id'] });

export const issueSchema = z.object({ skuId: objectId, locationId: objectId, recipient: recipientSchema, qty, note });

// Finish (and optionally hand out a replacement in the same step)
export const finishSchema = z.object({
  qty,
  note,
  replacement: z.object({ qty, locationId: objectId.optional(), recipient: recipientSchema.optional() }).optional(),
});

export const returnSchema = z.object({ qty, locationId: objectId.optional(), note });
export const moveSchema = z.object({ recipient: recipientSchema, qty: qty.optional(), note });
export const listHandoutsSchema = z.object({ skuId: objectId.optional() });
