import { z } from 'zod';

export const loginSchema = z.object({
  // Trim spaces and lowercase first, then check it's an email
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')) });
const token = z.string().min(20, 'This link isn’t complete').max(100, 'This link isn’t complete');
export const checkLinkSchema = z.object({ token });
export const resetPasswordSchema = z.object({ token, password: z.string().max(200) });
