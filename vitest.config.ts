import { defineConfig } from 'vitest/config';

/** Coverage instrumentation slows hot loops several-fold; benchmarks read this flag. */
const coverage = process.argv.includes('--coverage');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { ND_COVERAGE: coverage ? '1' : '' },
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
