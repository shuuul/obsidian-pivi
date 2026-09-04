import { McpManagementCoordinator } from '@pivi/agent/mcp/mcpManagementCoordinator';
import { listMcpServerSecretIds, McpStorage } from '@pivi/agent/mcp/mcpStorage';
import { listMcpAuthEntrySecretIds } from '@pivi/agent/mcp/oauth/mcpSecretAuthStore';
import type { AppMcpToolProvider } from '@pivi/agent/mcp/ports';
import type { ManagedMcpServer } from '@pivi/agent/mcp/types';
import type { FileStore, SyncSecretStore } from '@pivi/agent/ports';

class MemoryFileStore {
  private readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> { return this.files.get(path) ?? ''; }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async delete(path: string): Promise<void> { this.files.delete(path); }
  async ensureFolder(): Promise<void> {}
  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) throw new Error(`Missing file: ${oldPath}`);
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }
}

const server: ManagedMcpServer = {
  name: 'sentinel',
  config: { type: 'http', url: 'https://safe.example.test/mcp' },
  enabled: true,
  contextSaving: true,
};

describe('McpManagementCoordinator', () => {
  it('never projects raw tester diagnostics into the Agent result', async () => {
    const sentinel = 'TOKEN_SENTINEL at https://private.example/token from /Users/private/key';
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadSnapshot: jest.fn(async () => [{ ...server }]),
      } as unknown as McpStorage,
      toolProvider: {
        getCachedTools: () => [],
        cacheTools: jest.fn(),
      } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn(async () => ({ success: false, tools: [], error: sentinel })) },
    });

    const result = await coordinator.test('sentinel');

    expect(result).toEqual({ name: 'sentinel', success: false, error: 'Connection failed.' });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('cleans remote OAuth state and direct secrets after oauth is disabled', async () => {
    const remote: ManagedMcpServer = {
      ...server,
      auth: 'oauth',
      oauth: { clientId: 'client-id' },
      config: {
        type: 'http',
        url: 'https://safe.example.test/mcp',
        headers: { Authorization: { kind: 'secret' } },
      },
    };
    const values = new Map<string, string>();
    for (const id of [
      ...listMcpAuthEntrySecretIds(server.name),
      ...listMcpServerSecretIds(server.name, 'bearer-token'),
      ...listMcpServerSecretIds(server.name, 'client-secret'),
    ]) values.set(id, 'old-secret');
    const secretStorage: SyncSecretStore = {
      getSecret: id => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); },
      listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const saveIfRevision = jest.fn(async () => ({ revision: 'next', cleanupFailures: [] }));
    const removeOAuthArtifacts = jest.fn(async () => undefined);
    const storage = {
      loadRevisionedSnapshot: jest.fn(async () => ({ servers: [remote], revision: 'revision' })),
      saveIfRevision,
    } as unknown as McpStorage;
    const coordinator = new McpManagementCoordinator({
      storage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
      removeOAuthArtifacts,
    });
    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: { type: 'http', url: 'https://safe.example.test/mcp', oauth: false },
    });

    await coordinator.commit(plan);

    expect(saveIfRevision).toHaveBeenCalledWith([
      expect.objectContaining({ name: server.name, oauth: false }),
    ], 'revision');
    expect(removeOAuthArtifacts).toHaveBeenCalledWith(server.name);
    for (const id of [
      ...listMcpAuthEntrySecretIds(server.name),
      ...listMcpServerSecretIds(server.name, 'client-secret'),
    ]) expect(values.get(id)).toBe('');
    for (const id of listMcpServerSecretIds(server.name, 'bearer-token')) {
      expect(values.get(id)).toBe('old-secret');
    }
    expect(saveIfRevision.mock.invocationCallOrder[0]).toBeLessThan(removeOAuthArtifacts.mock.invocationCallOrder[0]!);
  });

  it('reuses the save revision and does not re-read after durable commit', async () => {
    const saveIfRevision = jest.fn(async () => ({ revision: 'published-rev', cleanupFailures: [] }));
    const loadRevisionedSnapshot = jest.fn(async () => ({ servers: [{ ...server }], revision: 'revision' }));
    const coordinator = new McpManagementCoordinator({
      storage: { loadRevisionedSnapshot, saveIfRevision } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
    });
    const plan = await coordinator.plan({ action: 'set_enabled', name: server.name, enabled: false });

    const result = await coordinator.commit(plan);

    expect(result).toMatchObject({
      revision: 'published-rev',
      saved: true,
      refreshed: true,
    });
    expect(loadRevisionedSnapshot).toHaveBeenCalledTimes(2); // plan + commit CAS only
  });

  it('preserves keychain credentials for every server during an unrelated mutation', async () => {
    const values = new Map<string, string>();
    const secretStorage: SyncSecretStore = {
      getSecret: id => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); },
      deleteSecret: id => { values.delete(id); },
      listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const storage = new McpStorage(new MemoryFileStore() as unknown as FileStore, secretStorage);
    await storage.save([
      {
        ...server,
        name: 'bearer-server',
        auth: 'bearer',
        bearerToken: 'bearer-secret',
      },
      {
        ...server,
        name: 'oauth-server',
        auth: 'oauth',
        oauth: { clientId: 'client-id', clientSecret: 'oauth-secret' },
      },
    ]);
    const coordinator = new McpManagementCoordinator({
      storage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
    });
    const plan = await coordinator.plan({
      action: 'set_enabled',
      name: 'bearer-server',
      enabled: false,
    });

    await coordinator.commit(plan);

    expect(values.get(listMcpServerSecretIds('bearer-server', 'bearer-token')[0]!)).toBe('bearer-secret');
    expect(values.get(listMcpServerSecretIds('oauth-server', 'client-secret')[0]!)).toBe('oauth-secret');
  });

  it('rejects a stale Settings save after a keychain credential changes', async () => {
    const values = new Map<string, string>();
    const secretStorage: SyncSecretStore = {
      getSecret: id => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); },
      deleteSecret: id => { values.delete(id); },
      listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const storage = new McpStorage(new MemoryFileStore() as unknown as FileStore, secretStorage);
    await storage.save([{
      ...server,
      auth: 'bearer',
      bearerToken: 'first-secret',
    }]);
    const coordinator = new McpManagementCoordinator({
      storage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
    });
    const stale = await coordinator.loadSettingsSnapshot();
    secretStorage.setSecret(listMcpServerSecretIds(server.name, 'bearer-token')[0]!, 'newer-secret');

    await expect(coordinator.replaceAll(stale.servers, stale.revision)).rejects.toMatchObject({
      code: 'state_changed',
    });
    expect(values.get(listMcpServerSecretIds(server.name, 'bearer-token')[0]!)).toBe('newer-secret');
  });

  it('returns saved:true refreshed:false when post-save SecretStorage projection fails', async () => {
    const saveIfRevision = jest.fn(async () => ({ revision: 'published-rev', cleanupFailures: [] }));
    const secretStorage: SyncSecretStore = {
      getSecret: () => {
        throw new Error('keychain unavailable');
      },
      setSecret: () => undefined,
      listSecrets: () => [],
    };
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadRevisionedSnapshot: jest.fn(async () => ({ servers: [{ ...server }], revision: 'revision' })),
        saveIfRevision,
      } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
    });
    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: { type: 'http', url: 'https://safe.example.test/mcp', auth: 'bearer' },
    });

    const result = await coordinator.commit(plan);

    expect(result).toMatchObject({
      revision: 'published-rev',
      saved: true,
      refreshed: false,
      warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
    });
    expect(result.effective).toBeUndefined();
    expect(result.refreshFailures).toEqual([
      expect.objectContaining({ target: 'projection', message: 'keychain unavailable' }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/bearer|secret|token/i);
  });

  it('replaces a static bearer token with an environment reference and retires the old secret', async () => {
    const oldSecretId = listMcpServerSecretIds(server.name, 'bearer-token')[0]!;
    const values = new Map([[oldSecretId, 'old-token']]);
    const secretStorage: SyncSecretStore = {
      getSecret: id => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); },
      listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const previous = { ...server, auth: 'bearer' as const, bearerToken: 'old-token' };
    const saveIfRevision = jest.fn(async (servers: readonly ManagedMcpServer[]) => {
      expect(servers[0]).toMatchObject({
        auth: 'bearer',
        bearerToken: undefined,
        bearerTokenEnv: 'MCP_TOKEN',
      });
      return { revision: 'next', cleanupFailures: [] };
    });
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadRevisionedSnapshot: jest.fn(async () => ({ servers: [previous], revision: 'revision' })),
        saveIfRevision,
      } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
    });

    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: {
        type: 'http',
        url: 'https://safe.example.test/mcp',
        auth: 'bearer',
        bearerToken: { source: 'systemEnvironment', variable: 'MCP_TOKEN' },
      },
    });
    await coordinator.commit(plan);

    expect(values.get(oldSecretId)).toBe('');
  });

  it('clears incompatible OAuth fields when switching authentication modes', async () => {
    const previous: ManagedMcpServer = {
      ...server,
      auth: 'oauth',
      oauth: {
        grantType: 'client_credentials',
        clientId: 'client-id',
        scope: 'read',
      },
    };
    const saveIfRevision = jest.fn(async (servers: readonly ManagedMcpServer[]) => {
      expect(servers[0]).toMatchObject({ auth: 'bearer' });
      expect(servers[0]).not.toHaveProperty('oauth');
      return { revision: 'next', cleanupFailures: [] };
    });
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadRevisionedSnapshot: jest.fn(async () => ({ servers: [previous], revision: 'revision' })),
        saveIfRevision,
      } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
    });
    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: {
        type: 'http',
        url: 'https://safe.example.test/mcp',
        auth: 'bearer',
        bearerToken: { source: 'systemEnvironment', variable: 'MCP_TOKEN' },
      },
    });

    await coordinator.commit(plan);
    expect(saveIfRevision).toHaveBeenCalledTimes(1);
  });
});
