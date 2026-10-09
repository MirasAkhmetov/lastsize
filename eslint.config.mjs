import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
    },
  },
  {
    // Nest resolves constructor dependencies from decorator metadata, so classes injected by type
    // are runtime imports. This tells the type-import rule about it.
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              message:
                'Import query helpers from @lastsize/db: the API is CommonJS and a direct import loads a second, incompatible drizzle-orm build.',
            },
          ],
        },
      ],
    },
  },
  {
    // Security boundary: the browser-facing app must never import server-only packages
    // (database access, integration providers, logger with server config). It talks to the API.
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // @lastsize/domain (pure rules, no I/O) is allowed so the UI uses the same discount formula.
              group: [
                '@lastsize/db',
                '@lastsize/db/*',
                '@lastsize/providers',
                '@lastsize/providers/*',
                'pg',
                'ioredis',
                'bullmq',
              ],
              message:
                'Frontend apps must go through the API. Direct database, queue or provider access is forbidden.',
            },
          ],
        },
      ],
    },
  },
);
