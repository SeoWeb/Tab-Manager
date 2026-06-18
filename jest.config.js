const nextJest = require('next/jest');

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  // Only run the explicit __tests__ suites; default discovery is too broad for
  // an extension repo that mixes Next pages and compiled output.
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // `backend/` is a separate package with its own test runner (vitest); exclude
  // it so the extension's jest never discovers the backend `__tests__`.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/build/', '/backend/'],
  // Map the `@/` path alias for runtime string resolution (e.g. jest.mock()).
  // next/jest merges this after its own CSS/image/font mocks.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = nextJest({ dir: './' })(config);
