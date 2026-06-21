import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        AudioContext: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        process: 'readonly',
        screen: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        window: 'readonly',
        WebSocket: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': {
        rules: {
          'exhaustive-deps': {
            meta: { type: 'suggestion', schema: [] },
            create: () => ({}),
          },
        },
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
