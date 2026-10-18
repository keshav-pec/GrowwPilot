import { z } from 'zod';
import { PAYMENT_METHODS } from '../../config/constants.js';
import { objectId, paise } from '../../utils/schemas.js';

// The client sends WHAT the customer chose (discounts, how they paid).
// It never sends totals or tax: the server works those out.

// flat: whole paise (e.g. 5000 = ₹50) · percent: 0 to 100, up to 2 decimals (e.g. 12.5 = 12.5%)
const discount = z
  .object({
    type: z.enum(['flat', 'percent']),
    value: z.number().min(0, 'Discount cannot be negative'),
  })
  .refine((d) => d.type !== 'flat' || Number.isInteger(d.value), { message: 'Discount must be in whole paise', path: ['value'] })
  .refine((d) => d.type !== 'percent' || (d.value <= 100 && Math.abs(d.value * 100 - Math.round(d.value * 100)) < 1e-9), { message: 'A percentage is 0 to 100, with at most 2 decimals', path: ['value'] });

export const paymentsSchema = z
  .array(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      amount: paise.min(1, 'Each payment must be more than ₹0'),
      reference: z.string().trim().max(100).optional(), // e.g. UPI transaction id; never a card number
    })
  )
  .max(5, 'At most 5 payment methods');

// Changes to a draft bill
const edits = {
  billDiscount: discount.nullable().optional(),
  lines: z
    .array(
      z.object({
        lineId: objectId,
        discount: discount.nullable().optional(),
        unitPrice: paise.optional(), // owners only
        priceChangeReason: z.string().trim().max(200).optional(),
      })
    )
    .max(50)
    .optional(),
};
const version = z.number().int().min(0);

export const openDraftSchema = z.object({ appointmentId: objectId });
export const quoteSchema = z.object(edits);
export const saveDraftSchema = z.object({ version, ...edits });
export const issueSchema = z.object({ version, ...edits, payments: paymentsSchema.default([]) });
export const requestApprovalSchema = z.object({ version, ...edits, note: z.string().trim().max(300).optional() });
export const approveSchema = z.object({ version, note: z.string().trim().max(300).optional() });
export const rejectSchema = z.object({ version, note: z.string().trim().min(2, 'Say why the discount is turned down').max(300) });

export const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'DUE']).optional(),
  branchId: z.union([z.literal('all'), objectId]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
