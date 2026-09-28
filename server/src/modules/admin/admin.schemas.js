import { z } from 'zod';
import { PLANS } from '../../config/constants.js';
import { email, optionalPhone, timezone } from '../../utils/schemas.js';

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
  timezone: timezone.default('Asia/Kolkata'),
});

export const setStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
