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
    '^@pivi/engine-pi/application/oauth-flows$':
      '<rootDir>/tests/__mocks__/registerPiviBundledOAuthFlowLoaders.ts',
    '^@pivi/engine-pi/registerBundledPiOAuthFlows$':
      '<rootDir>/tests/__mocks__/registerPiviBundledOAuthFlowLoaders.ts',
    '^@pivi/engine-pi/(piChatRuntime|piChatRuntimeActiveTurn|piChatRuntimeCompaction|piChatRuntimeConnectivity|piChatRuntimeTurn|piChatRuntimeUsage|piChatRetry|piAgentEventAdapter|piAuxQueryRunner|piBackgroundSubagentJobs|piCompactionSampler|piReadBudget|piRuntimeHost|piImageContent|codexImageGenerator|subagentConcurrencyLimiter)$':
      '<rootDir>/packages/engine-pi/src/runtime/$1',
    '^@pivi/engine-pi/(buildPiToolRegistryCore|createSkillTool|createSubagentTool|piToolAdapter)$':
      '<rootDir>/packages/engine-pi/src/tools/$1',
    '^@pivi/engine-pi/(piAiModels|installPiCustomProviders|piModelEnv|piModelRegistry|piThinkingLevels|piChatUiConfig|piSettingsCoordinator|grokBuildProvider|scopedGoogleProvider|splitProviderAuth)$':
      '<rootDir>/packages/engine-pi/src/models/$1',
    '^@pivi/engine-pi/(membershipAwareCredentialMigration|piProviderCredentialStore|piProviderOAuthService|piAuthInteraction|deviceVerificationUri|piviOpenRouterOAuth|piviXaiOAuthDeviceFlow|registerPiviBundledOAuthFlowLoaders)$':
      '<rootDir>/packages/engine-pi/src/auth/$1',
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
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: [
        '<rootDir>/tests/setupWindow.ts',
        '<rootDir>/tests/setupObsidianUi.ts',
      ],
      testMatch: ['<rootDir>/tests/jsdom/**/*.test.{ts,tsx}'],
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
    './packages/agent/src/network/egressPolicy.ts': {
      branches: 70,
    },
    './packages/agent/src/network/ipClassification.ts': {
      branches: 70,
    },
    './packages/agent/src/network/urlPolicy.ts': {
      branches: 80,
    },
    './packages/agent/src/mcp/mcpProcessEnv.ts': {
      branches: 90,
    },
    './packages/agent/src/mcp/mcpValidation.ts': {
      branches: 70,
    },
    './packages/agent/src/mcp/oauth/mcpCallbackServer.ts': {
      branches: 45,
    },
    './packages/engine-pi/src/session/piSessionManagerPrivateAdapter.ts': {
      branches: 80,
    },
  },
  coverageDirectory: 'coverage',
};
