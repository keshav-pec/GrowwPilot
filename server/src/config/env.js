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
});

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
