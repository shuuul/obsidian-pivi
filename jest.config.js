/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = {
  preset: 'ts-jest',
  testTimeout: 15_000,
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
    '^@earendil-works/pi-ai/providers/(anthropic|deepseek|google|kimi-coding|minimax|minimax-cn|moonshotai|moonshotai-cn|openai|openai-codex|opencode|opencode-go|openrouter|xiaomi|xiaomi-token-plan-cn|zai|zai-coding-cn)$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-coding-agent$': '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
    '^@earendil-works/pi-coding-agent/dist/core/skills\\.js$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
    '^@earendil-works/pi-coding-agent/dist/core/session-manager\\.js$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
    '^@earendil-works/pi-coding-agent/dist/core/auth-storage\\.js$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
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
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/tests/setupWindow.ts'],
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    },
    {
      ...baseConfig,
      displayName: 'integration',
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/tests/setupWindow.ts'],
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
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
      statements: 47,
      branches: 39,
      functions: 46,
      lines: 48,
    },
  },
  coverageDirectory: 'coverage',
};
