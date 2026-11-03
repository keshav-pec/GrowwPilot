import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests use their own in-memory database, never the real one. These values just satisfy env.js.
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://not-used-in-tests',
      JWT_SECRET: 'test-secret-for-vitest-only',
      // Never the real email settings from .env: tests must not send real emails (blank = not set)
      MAIL_SCRIPT: '',
      MAIL_SCRIPT_SECRET: '',
      MAIL_FORGOT_PASSWORD: '',
      EMAIL_USER: '',
      EMAIL_PASS: '',
      MAIL_DAILY_LIMIT: '90',
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    testTimeout: 30_000,
    hookTimeout: 180_000, // the first run downloads a MongoDB binary
    fileParallelism: false,
  },
});
