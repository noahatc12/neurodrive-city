import { defineConfig } from 'vitest/config';

/** Coverage instrumentation slows hot loops several-fold; benchmarks read this flag. */
const coverage = process.argv.includes('--coverage');

/** Benchmarks run alone, after every other test file (see `sequence.groupOrder`). */
const BENCHMARKS = ['tests/**/performance.test.ts'];

export default defineConfig({
  test: {
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: BENCHMARKS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'benchmark', include: BENCHMARKS, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
