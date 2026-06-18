import { defineConfig } from 'vitest/config';

// Backend unit tests run in Node against the pure logic (JWT sign/verify,
// validation helpers). For tests that need the Workers runtime + D1, add the
// `@cloudflare/vitest-pool-workers` pool and a wrangler.toml binding here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
