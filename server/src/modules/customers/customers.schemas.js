import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';
import { occasionDate } from '../occasions/occasions.schemas.js';
import { normalizePhone, PHONE_REGEX } from '../../utils/phone.js';
import { isValidGstin } from '../../config/billing.js';

export const listCustomersSchema = z.object({
  search: z.string().trim().optional(), // name or phone
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const phone = z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_REGEX, 'Enter a valid 10-digit mobile number'));
const email = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'))]);
// Business customers: empty clears it
const gstin = z.string().trim().toUpperCase().refine((v) => v === '' || isValidGstin(v), 'This GSTIN doesn’t look right. Please check it.');

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone,
  email: email.optional(),
  gstin: gstin.optional(),
  gstLegalName: z.string().trim().max(120).optional(),
  // Birthday and anniversary: { month, day? } or null (clear). The old full date of birth is no longer taken.
  birthday: occasionDate.optional(),
  anniversary: occasionDate.optional(),
  homeBranchId: objectId.optional(), // new customers: the branch they were added at, unless chosen
  confirmOfferChange: z.boolean().optional(), // yes, a corrected date may replace this month's unused offer
  notes: z.string().trim().max(1000).optional(),
  preferredStaffId: z.union([z.literal(''), objectId]).optional(), // '' = no preference
});

// Editing: send only what changed
export const updateCustomerSchema = createCustomerSchema.partial();
