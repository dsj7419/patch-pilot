import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsoncParser from 'jsonc-eslint-parser';
export default [
  // Base configuration - what to ignore globally
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/*.d.ts',
      '.vscode-test/**',
      'coverage/**',
      '*.mjs',
      'build-webview.js',
      'esbuild.js',
      'jest.config.js',
      'webpack.config.js',
      'scripts/**',
      '**/*.md',
      '**/LICENSE',
      '.github/CODEOWNERS',
      '**/*.html'
    ]
  },
  // Scripts JS files
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      parserOptions: {
        project: null // Don't use any tsconfig for JS files
      }
    },
    rules: {
      'curly': 'warn',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      'semi': 'warn',
      'no-console': 'off'
    }
  },
  // Source TypeScript files
  {
    files: ['src/**/*.ts', '!src/test/**/*.ts'],
    plugins: { '@typescript-eslint': typescriptEslint },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      'curly': 'warn',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      'semi': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  // Test TypeScript files
  {
    files: ['src/test/**/*.ts'],
    plugins: { '@typescript-eslint': typescriptEslint },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.test.json'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off'
    }
  },
  // JSON files
  {
    files: ['**/*.json', '**/*.jsonc', 'tsconfig*.json'],
    languageOptions: {
      parser: jsoncParser,
      parserOptions: {
        extraFileExtensions: ['.json']
      }
    }
  },
  // Webview TypeScript
  {
    files: ['webview/**/*.ts'],
    plugins: { '@typescript-eslint': typescriptEslint },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.webview.json'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'curly': 'warn',
      'eqeqeq': 'warn',
      'semi': 'warn'
    }
  }
];