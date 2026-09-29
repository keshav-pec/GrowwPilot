import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';
import { normalizePhone, PHONE_REGEX } from '../../utils/phone.js';

export const listCustomersSchema = z.object({
  search: z.string().trim().optional(), // name or phone
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const phone = z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_REGEX, 'Enter a valid 10-digit mobile number'));
const email = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'))]);
const dob = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')]); // '' = not set

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone,
  email: email.optional(),
  dob: dob.optional(),
  notes: z.string().trim().max(1000).optional(),
  preferredStaffId: z.union([z.literal(''), objectId]).optional(), // '' = no preference
});

// Editing: send only what changed
export const updateCustomerSchema = createCustomerSchema.partial();
