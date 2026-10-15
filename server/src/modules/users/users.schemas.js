import { z } from 'zod';
import { email, objectId, optionalPhone } from '../../utils/schemas.js';

// Logins that work in exactly one branch
export const ONE_BRANCH_ROLES = ['FRONT_DESK', 'INVENTORY'];

// A front desk or inventory login (exactly one branch) or a branch owner (one or more branches)
export const createUserSchema = z
  .object({
    role: z.enum(['FRONT_DESK', 'INVENTORY', 'OWNER']),
    name: z.string().trim().min(2, 'Name is required'),
    email,
    phone: optionalPhone,
    branchIds: z.array(objectId).min(1, 'Choose at least one branch'),
  })
  .refine((u) => !ONE_BRANCH_ROLES.includes(u.role) || u.branchIds.length === 1, {
    message: 'This login works in exactly one branch',
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
