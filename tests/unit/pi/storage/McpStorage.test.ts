import { SecretStorage } from 'obsidian';

import type { VaultFileAdapter } from '../../../../src/core/storage/VaultFileAdapter';
import type { ManagedMcpServer } from '../../../../src/core/types';
import { McpStorage, PIVI_MCP_CONFIG_PATH } from '../../../../src/pi/storage/McpStorage';

class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();
  private readonly folders = new Set<string>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? '';
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  readSync(path: string): string {
    return this.files.get(path) ?? '';
  }
}

function remoteServer(overrides: Partial<ManagedMcpServer> = {}): ManagedMcpServer {
  return {
    name: 'remote',
    config: { type: 'http', url: 'https://mcp.example.com' },
    enabled: true,
    contextSaving: true,
    ...overrides,
  };
}

describe('McpStorage', () => {
  it('stores static MCP bearer tokens in SecretStorage instead of mcp.json', async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as VaultFileAdapter, secretStorage);

    await storage.save([
      remoteServer({
        auth: 'bearer',
        bearerToken: 'bearer-secret',
      }),
    ]);

    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).not.toContain('bearer-secret');
    expect(JSON.parse(raw)._pivi.servers.remote.bearerToken).toBeUndefined();

    const loaded = await storage.load();
    expect(loaded[0].bearerToken).toBe('bearer-secret');
  });

  it('stores static OAuth client secrets in SecretStorage instead of mcp.json', async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as VaultFileAdapter, secretStorage);

    await storage.save([
      remoteServer({
        auth: 'oauth',
        oauth: {
          grantType: 'client_credentials',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        },
      }),
    ]);

    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).toContain('client-id');
    expect(raw).not.toContain('client-secret');
    expect(JSON.parse(raw)._pivi.servers.remote.oauth.clientSecret).toBeUndefined();

    const loaded = await storage.load();
    expect(loaded[0].oauth).toMatchObject({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
  });

  it('migrates legacy plaintext MCP secrets out of mcp.json on load', async () => {
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: `${JSON.stringify({
        mcpServers: {
          remote: { type: 'http', url: 'https://mcp.example.com' },
        },
        _pivi: {
          servers: {
            remote: {
              auth: 'oauth',
              oauth: {
                clientId: 'client-id',
                clientSecret: 'legacy-client-secret',
              },
              bearerToken: 'legacy-bearer-secret',
            },
          },
        },
      }, null, 2)}\n`,
    });
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as VaultFileAdapter, secretStorage);

    const loaded = await storage.load();

    expect(loaded[0].oauth).toMatchObject({ clientSecret: 'legacy-client-secret' });
    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).not.toContain('legacy-client-secret');
    expect(raw).not.toContain('legacy-bearer-secret');
  });
});
