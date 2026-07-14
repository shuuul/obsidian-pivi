/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = {
  preset: 'ts-jest',
  testTimeout: 15_000,
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setupWindow.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  roots: ['<rootDir>/src', '<rootDir>/packages', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/tests/$1',
    '^@pivi/([^/]+)$': '<rootDir>/packages/$1/src/index.ts',
    '^@pivi/([^/]+)/(.*)$': '<rootDir>/packages/$1/src/$2',
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^@earendil-works/pi-agent-core$': '<rootDir>/tests/__mocks__/@earendil-works/pi-agent-core.ts',
    '^@earendil-works/pi-ai$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-ai/providers/all$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-ai/providers/.*$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-coding-agent$': '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
    '^@earendil-works/pi-ai/oauth$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai-oauth.ts',
    '^@earendil-works/pi-ai/api/(.*)$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai-api.ts',
    '\\.svg$': '<rootDir>/tests/__mocks__/svg.ts',
  },
};

module.exports = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/tests/unit/**/*.test.ts',
        '<rootDir>/tests/integration/**/*.test.ts',
      ],
    },
    {
      ...baseConfig,
      displayName: 'pivi-react',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: [
        '<rootDir>/tests/setupWindow.ts',
        '<rootDir>/tests/setupObsidianUi.ts',
      ],
      testMatch: [
        '<rootDir>/tests/pivi-react/**/*.test.ts',
        '<rootDir>/tests/pivi-react/**/*.test.tsx',
      ],
    },
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'packages/*/src/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageReporters: ['json-summary', 'lcov', 'text', 'clover'],
  coverageThreshold: {
    global: {
      statements: 61,
      branches: 51,
      functions: 58,
      lines: 62,
    },
  },
  coverageDirectory: 'coverage',
};
