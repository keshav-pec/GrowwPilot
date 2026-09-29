import { z } from 'zod';
import { normalizePhone, PHONE_REGEX } from '../../utils/phone.js';

export const searchCustomersSchema = z.object({
  search: z.string().trim().optional(),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_REGEX, 'Enter a valid 10-digit mobile number')),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'))]).optional(),
  notes: z.string().trim().max(1000).optional(),
});
