import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      thresholds: {
        'src/engine/**': { lines: 80 },
        'src/engine/math/**': { lines: 90 },
        'src/engine/graph/**': { lines: 90 },
      },
    },
  },
});
