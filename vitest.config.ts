import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/__disabled__/**/*.test.ts'],
    globals: true,
  },
});
