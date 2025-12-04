// jest.config.js
/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
      '^.+\\.tsx?$': ['ts-jest', {
        tsconfig: 'tsconfig.test.json'
      }]
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/test/**',
      '!**/node_modules/**',
      '!**/vendor/**'
    ],
    coverageReporters: ['json', 'lcov', 'text', 'clover'],
    coverageThreshold: {
      global: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80
      }
    },
    verbose: true,
    testTimeout: 15000,
    setupFilesAfterEnv: ['<rootDir>/src/test/setup/jest.setup.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/out/']
  };