import { z } from 'zod';

export const loginSchema = z.object({
  // Trim spaces and lowercase first, then check it's an email
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
});
