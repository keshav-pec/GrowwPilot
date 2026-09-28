import { z } from 'zod';
import { email, objectId, optionalPhone } from '../../utils/schemas.js';

// A front desk account (exactly one branch) or a branch owner (one or more branches)
export const createUserSchema = z
  .object({
    role: z.enum(['FRONT_DESK', 'OWNER']),
    name: z.string().trim().min(2, 'Name is required'),
    email,
    phone: optionalPhone,
    branchIds: z.array(objectId).min(1, 'Choose at least one branch'),
  })
  .refine((u) => u.role !== 'FRONT_DESK' || u.branchIds.length === 1, {
    message: 'A front desk account works in exactly one branch',
    path: ['branchIds'],
  });

// Email is the login, so it can't be changed here
export const updateUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').optional(),
  phone: optionalPhone,
  branchIds: z.array(objectId).min(1, 'Choose at least one branch').optional(),
});

export const userStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
