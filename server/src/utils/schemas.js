// Zod pieces that many request schemas share.
import { z } from 'zod';
import { isValidTimezone } from './time.js';
import { normalizePhone, PHONE_REGEX } from './phone.js';

// A MongoDB id: 24 hex characters
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Trim spaces and lowercase first, then check it's an email
export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

// Optional phone: empty is fine, otherwise it must be a valid 10-digit mobile number
export const optionalPhone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => v === '' || PHONE_REGEX.test(v), 'Enter a valid 10-digit mobile number')
  .optional();

export const timezone = z.string().refine(isValidTimezone, 'Choose a valid timezone');

// "09:00", "21:30"
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:30');

// Money always travels as whole paise
export const paise = z.number().int('Amount must be in whole paise').min(0, 'Amount cannot be negative');
