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
    '^~/env$': '<rootDir>/src/__mocks__/env.ts',
    '^nanoid$': '<rootDir>/src/__mocks__/nanoid.ts',
    // Mirrors the `@blueprint/*` path alias in tsconfig.json. The blueprint engine is
    // shared *source* in ../tui, not a package, so Jest has to be told the same thing
    // TypeScript already knows. The `.ts` suffix is how the TUI writes its imports.
    '^@blueprint/(.*)$': '<rootDir>/../tui/src/blueprint/$1',
    '^~/(.*)$': '<rootDir>/src/$1'
  },
  // pnpm nests deps under node_modules/.pnpm/..., so match that structure too.
  // Allow nanoid to be transformed instead of failing on `import`.
  transformIgnorePatterns: ['node_modules/(?!(\\.pnpm/|nanoid/))'],
  clearMocks: true,
  restoreMocks: true
};
