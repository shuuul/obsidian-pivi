import type { ChatPorts } from '@pivi/obsidian-ui/ports';

/** Minimal fake ChatPorts for mount/shell tests — no cast-to-empty object. */
export function createFakeChatPorts(
  overrides: Partial<{
    runtime: Partial<ChatPorts['runtime']>;
    sessions: Partial<ChatPorts['sessions']>;
    catalog: Partial<ChatPorts['catalog']>;
    models: Partial<ChatPorts['models']>;
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
      getOpenSession: async () => null,
      createSession: async () => ({ id: 'fake-session' }) as never,
      openSessionFile: async () => ({ id: 'fake-session' }) as never,
      deleteSession: async () => undefined,
      renameSession: async () => undefined,
      updateSession: async () => undefined,
      listSessionLeaves: async () => [],
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
      ...overrides.models,
    },
  };
}
