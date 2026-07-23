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
    '^@pivi/pivi-agent-core/engine/pi/registerBundledPiOAuthFlows$':
      '<rootDir>/tests/__mocks__/registerPiviBundledOAuthFlowLoaders.ts',
    '^@pivi/([^/]+)$': '<rootDir>/packages/$1/src/index.ts',
    '^@pivi/([^/]+)/(.*)$': '<rootDir>/packages/$1/src/$2',
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^@earendil-works/pi-agent-core$': '<rootDir>/tests/__mocks__/@earendil-works/pi-agent-core.ts',
    '^@earendil-works/pi-ai/dist/(.*)$': '<rootDir>/node_modules/@earendil-works/pi-ai/dist/$1',
    '^@earendil-works/pi-ai$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-ai/bun-oauth$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai-bun-oauth.ts',
    '^@earendil-works/pi-ai/providers/all$': '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-ai/providers/.*$':
      '<rootDir>/tests/__mocks__/@earendil-works/pi-ai.ts',
    '^@earendil-works/pi-coding-agent$': '<rootDir>/tests/__mocks__/@earendil-works/pi-coding-agent.ts',
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
    // Direct security-boundary thresholds (specs 030–034 / 036). Unrelated UI
    // coverage cannot satisfy these paths.
    './packages/obsidian-host/src/systemProcessRunner.ts': {
      branches: 70,
    },
    './packages/obsidian-host/src/path/index.ts': {
      branches: 40,
    },
    './packages/obsidian-host/src/scopedHttpClient.ts': {
      branches: 50,
    },
    './packages/pivi-agent-core/src/network/egressPolicy.ts': {
      branches: 70,
    },
    './packages/pivi-agent-core/src/network/ipClassification.ts': {
      branches: 70,
    },
    './packages/pivi-agent-core/src/network/urlPolicy.ts': {
      branches: 80,
    },
    './packages/pivi-agent-core/src/mcp/mcpProcessEnv.ts': {
      branches: 55,
    },
    './packages/pivi-agent-core/src/mcp/mcpValidation.ts': {
      branches: 70,
    },
    './packages/pivi-agent-core/src/mcp/mcpResultBudget.ts': {
      branches: 45,
    },
    './packages/pivi-agent-core/src/mcp/oauth/mcpCallbackServer.ts': {
      branches: 45,
    },
    './packages/pivi-agent-core/src/skills/vault/skillStagePublish.ts': {
      branches: 50,
    },
    './packages/pivi-agent-core/src/skills/vault/resolvePinnedSkillsCli.ts': {
      branches: 40,
    },
    './packages/pivi-agent-core/src/runtime/highRisk/approvalController.ts': {
      branches: 45,
    },
    './packages/pivi-agent-core/src/engine/pi/session/piSessionManagerPrivateAdapter.ts': {
      branches: 80,
    },
  },
  coverageDirectory: 'coverage',
};
