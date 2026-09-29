import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests use their own in-memory database, never the real one. These values just satisfy env.js.
    env: { NODE_ENV: 'test', MONGODB_URI: 'mongodb://not-used-in-tests', JWT_SECRET: 'test-secret-for-vitest-only' },
    testTimeout: 30_000,
    hookTimeout: 180_000, // the first run downloads a MongoDB binary
    fileParallelism: false,
  },
});
