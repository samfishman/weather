import { defineConfig } from 'vitest/config';

// Tests cover the shared modules only, so they skip the Cloudflare and Preact plugins.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
