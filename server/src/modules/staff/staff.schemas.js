import { z } from 'zod';
import { email, objectId, optionalPhone } from '../../utils/schemas.js';

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  role: z.string().trim().min(2, 'Role is required'), // Stylist, Beautician, ...
  phone: optionalPhone,
  email: email.optional().or(z.literal('')),
  branchId: objectId,
});

export const updateStaffSchema = createStaffSchema.partial();

export const staffStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'archived']),
  // The owner has seen the list of future bookings and still wants to go ahead
  confirm: z.boolean().optional(),
});
