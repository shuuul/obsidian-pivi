/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 15_000,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupWindow.ts'],
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
    '\\.svg$': '<rootDir>/tests/__mocks__/svg.ts',
  },
};

module.exports = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    },
    {
      ...baseConfig,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
};
