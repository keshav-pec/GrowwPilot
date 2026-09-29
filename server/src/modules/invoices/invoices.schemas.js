import { z } from 'zod';
import { PAYMENT_METHODS } from '../../config/constants.js';
import { objectId, paise } from '../../utils/schemas.js';

// The client sends WHAT the customer chose (discount, how they paid).
// It never sends the price: the server works that out from the appointment.
export const createInvoiceSchema = z.object({
  appointmentId: objectId,
  discountType: z.enum(['flat', 'percent']).default('flat'),
  // flat: whole paise (e.g. 5000 = ₹50) · percent: 0 to 100 (e.g. 10 = 10%)
  discountValue: z.number().min(0, 'Discount cannot be negative').default(0),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: paise.min(1, 'Each payment must be more than ₹0'),
        reference: z.string().trim().max(100).optional(), // e.g. UPI transaction id
      })
    )
    .max(5, 'At most 5 payment methods'),
});
