import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from the .env file into process.env
dotenv.config({ quiet: true });

// The shape we expect our environment variables to have
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  // How many proxies sit in front of the API (Vercel -> Render = 2). Needed to see the real visitor IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  // Where product photos are kept. Only MongoDB GridFS for now; a Cloudinary store can be added later.
  IMAGE_STORAGE: z.enum(['gridfs']).default('gridfs'),

  // --- Email (EMAIL_PLAN.md). All optional: with none set, email is "not set up". ---
  // Google Apps Script web app (/exec link) that sends the emails, and the secret it checks
  MAIL_SCRIPT: optional(z.url()),
  MAIL_SCRIPT_SECRET: optional(z.string().min(24, 'MAIL_SCRIPT_SECRET must be at least 24 characters')),
  MAIL_FORGOT_PASSWORD: optional(z.url()), // a second script for password emails (defaults to MAIL_SCRIPT)
  MAIL_SCRIPT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  // Gmail SMTP backup. Only used when both EMAIL_USER and EMAIL_PASS (a Gmail app password) are set.
  // Render's free plan blocks SMTP ports, so there it never works.
  EMAIL_HOST: z.string().default('smtp.gmail.com'),
  EMAIL_PORT: z.coerce.number().int().default(587),
  EMAIL_USER: optional(z.email()),
  EMAIL_PASS: optional(z.string()),
  MAIL_DAILY_LIMIT: z.coerce.number().int().min(1).default(90), // whole platform, per 24 hours (Gmail allows ~100)
}).superRefine((values, ctx) => {
  if (values.MAIL_SCRIPT && !values.MAIL_SCRIPT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['MAIL_SCRIPT_SECRET'], message: 'MAIL_SCRIPT_SECRET is required when MAIL_SCRIPT is set' });
  }
});

// Blank values and the examples from .env.example ("your-email@gmail.com", "xxxx") count as "not set"
function optional(schema) {
  const PLACEHOLDER = /^$|your[-_]|x{4}|example\.com|change[-_]?me|placeholder/i;
  return z.preprocess((v) => (typeof v === 'string' && PLACEHOLDER.test(v.trim()) ? undefined : v?.trim?.() ?? v), schema.optional());
}

const result = envSchema.safeParse(process.env);

// Stop the server right away if something is missing or wrong
if (!result.success) {
  console.error('Invalid environment variables:');
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
