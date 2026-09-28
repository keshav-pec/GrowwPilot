import { z } from 'zod';
import { PLANS } from '../../config/constants.js';
import { isValidTimezone } from '../../utils/time.js';
import { normalizePhone, PHONE_REGEX } from '../../utils/phone.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

// Phone is optional, but if given it must be a valid 10-digit mobile number
const optionalPhone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => v === '' || PHONE_REGEX.test(v), 'Enter a valid 10-digit mobile number')
  .optional();

export const listOrgsSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

// Onboarding creates the salon, its first branch and its owner in one go
export const createOrgSchema = z.object({
  name: z.string().trim().min(2, 'Salon name is required'),
  city: z.string().trim().min(2, 'City is required'),
  plan: z.enum(PLANS).default('trial'),

  ownerName: z.string().trim().min(2, 'Owner name is required'),
  ownerEmail: email,
  ownerPhone: optionalPhone,

  branchName: z.string().trim().min(2, 'Branch name is required'),
  branchAddress: z.string().trim().optional(),
  timezone: z.string().refine(isValidTimezone, 'Choose a valid timezone').default('Asia/Kolkata'),
});

export const setStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
