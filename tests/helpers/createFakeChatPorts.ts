import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';

/** Minimal fake ChatPorts for mount/shell tests — no cast-to-empty object. */
export function createFakeChatPorts(
  overrides: Partial<{
    runtime: Partial<ChatPorts['runtime']>;
    sessions: Partial<ChatPorts['sessions']>;
    catalog: Partial<ChatPorts['catalog']>;
    models: Partial<ChatPorts['models']>;
    settings: Partial<ChatPorts['settings']>;
  }> = {},
): ChatPorts {
  return {
    runtime: {
      createChatService: () => ({ id: 'fake-chat-service' }) as never,
      createAuxQueryRunner: () => ({ id: 'fake-aux-runner' }) as never,
      ...overrides.runtime,
    },
    sessions: {
      listSessions: () => [],
      findOpenSession: () => null,
      getOpenSession: async () => null,
      createSession: async () => ({ id: 'fake-session' }) as never,
      openSessionFile: async () => ({ id: 'fake-session' }) as never,
      deleteSession: async () => undefined,
      renameSession: async () => undefined,
      updateSession: async () => undefined,
      forkSession: async () => null,
      ...overrides.sessions,
    },
    catalog: {
      listMcpServers: () => [],
      listContextSavingMcpServers: () => [],
      listMcpTools: async () => [],
      listSkills: () => [],
      listSlashEntries: async () => [],
      getSlashDropdownConfig: () => ({
        triggerChars: ['/'],
        builtInPrefix: '',
        skillPrefix: '',
        commandPrefix: '',
      }),
      refreshSlashCatalog: async () => undefined,
      ...overrides.catalog,
    },
    models: {
      getReadinessProvider: () => null,
      getModelOptions: () => [],
      isAdaptiveReasoningModel: () => false,
      getReasoningOptions: () => [],
      getDefaultReasoningValue: () => 'medium',
      getContextWindowSize: () => 128_000,
      applyModelDefaults: () => undefined,
      prepareModelMetadata: async () => undefined,
      ...overrides.models,
    },
    settings: {
      getSettingsSnapshot: () => ({
        model: 'openrouter/openai/gpt-4.1',
        thinkingBudget: 'medium',
        thinkingLevel: 'medium',
        customContextLimits: {},
        enableAutoScroll: true,
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        userName: '',
        excludedTags: [],
        keyboardNavigation: {
          scrollUpKey: 'w',
          scrollDownKey: 's',
          focusInputKey: 'i',
        },
        requireCommandOrControlEnterToSend: false,
        environmentVariables: '',
        externalReadDirectories: [],
        hiddenSlashCommands: [],
        modelCatalog: {
          addedProviders: [],
          disabledProviders: [],
          visibleModels: [],
          customProviders: [],
        },
      }),
      commitSettingsSnapshot: async () => undefined,
      setPinnedExternalReadDirectories: async () => undefined,
      ...overrides.settings,
    },
  };
}
