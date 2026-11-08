// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Browser / DOM globals that must never appear in the pure engine. */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'Image',
  'process',
].map((name) => ({ name, message: 'src/engine must stay DOM/Node free (pure TypeScript).' }));

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'node_modules/**',
      'e2e/__screenshots__/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Tests may use @ts-expect-error when they deliberately pass bad input, with a reason.
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
  {
    // Engine/renderer separation: the engine is pure TypeScript.
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: { ...globals.es2021 } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'No Three.js in src/engine.' },
            {
              group: [
                '**/render2d/**',
                '**/render3d/**',
                '**/ui/**',
                '**/editor/**',
                '**/app/**',
                '**/viz/**',
                '**/debug/**',
                '**/anim/**',
                '**/workers/**',
              ],
              message: 'src/engine must not depend on UI, renderer or app code.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seedable PRNG in src/engine/math/rng.ts.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', '*.config.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
