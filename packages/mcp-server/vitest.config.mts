import { defineConfig } from 'vitest/config';

// Without a config of its own, vitest walks up and finds the app's root
// vitest.config.ts — React plugin, jsdom setup file and all. This package is
// plain Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
