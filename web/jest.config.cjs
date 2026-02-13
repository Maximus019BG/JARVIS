/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // Use babel-jest for ESM deps inside node_modules (e.g. nanoid).
    '^.+\\.m?[jt]sx?$': 'babel-jest'
  },
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1'
  },
  // pnpm nests deps under node_modules/.pnpm/..., so match that structure too.
  // Allow nanoid to be transformed instead of failing on `import`.
  transformIgnorePatterns: ['node_modules/(?!\\.pnpm/|nanoid/)'],
  clearMocks: true,
  restoreMocks: true
};
