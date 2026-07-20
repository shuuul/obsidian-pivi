import { createHash } from 'crypto';

import {
  getCustomProviderHeaderSecretId,
  parseCustomProviderHeaderSecret,
  writeCustomProviderHeaders,
} from '@pivi/pivi-agent-core/auth/customProviderHeaderSecrets';
import { PIVI_MCP_OAUTH_DIR } from '@pivi/pivi-agent-core/mcp/paths';
import { getMcpAuthEntrySecretId } from '@pivi/pivi-agent-core/mcp/oauth/mcpSecretAuthStore';
import { McpVaultAuthStore } from '@pivi/pivi-agent-core/mcp/oauth/mcpVaultAuthStore';
import type { FileStore } from '@pivi/pivi-agent-core/ports';

function entryPath(serverName: string): string {
  const storageKey = createHash('sha256').update(serverName, 'utf8').digest('hex');
  return `${PIVI_MCP_OAUTH_DIR}/sha256-${storageKey}/tokens.json`;
}

class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();
  private readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`missing: ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async deleteFolder(path: string): Promise<void> {
    this.folders.delete(path);
    for (const filePath of [...this.files.keys()]) {
      if (filePath.startsWith(`${path}/`)) {
        this.files.delete(filePath);
      }
    }
  }

  async listFolders(path: string): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const folder of this.folders) {
      if (folder.startsWith(prefix)) {
        const remainder = folder.slice(prefix.length);
        const top = remainder.split('/')[0];
        if (top) {
          names.add(top);
        }
      }
    }
    return [...names];
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
}

describe('mcpAuthEntryMigration', () => {
  it('migrates vault OAuth entries into SecretStorage and cleans plaintext files', async () => {
    const { migrateMcpAuthEntriesToSecretStorage } = await import(
      '@pivi/pivi-agent-core/mcp/oauth/mcpAuthEntryMigration'
    );
    const adapter = new MemoryVaultAdapter();
    const vaultStore = new McpVaultAuthStore(adapter as never);
    await vaultStore.saveEntry('github', {
      tokens: { accessToken: 'token-a', refreshToken: 'refresh-a' },
      clientInfo: { clientId: 'client-id' },
      codeVerifier: 'verifier',
      oauthState: 'state',
      serverUrl: 'https://mcp.example.com',
    }, 'https://mcp.example.com');

    const secretStorage = {
      secrets: new Map<string, string>(),
      getSecret(id: string) {
        return this.secrets.get(id) ?? null;
      },
      setSecret(id: string, value: string) {
        if (!value) {
          this.secrets.delete(id);
          return;
        }
        this.secrets.set(id, value);
      },
      listSecrets(prefix: string) {
        return [...this.secrets.keys()].filter((id) => id.startsWith(prefix));
      },
    };

    const result = await migrateMcpAuthEntriesToSecretStorage(
      adapter as never,
      secretStorage,
      ['github'],
    );

    expect(result.migratedServerNames).toEqual(['github']);
    expect(secretStorage.getSecret(getMcpAuthEntrySecretId('github'))).toContain('token-a');
    await expect(adapter.exists(entryPath('github'))).resolves.toBe(false);
  });

  it('cleans orphan vault OAuth folders even when no listed server migrates', async () => {
    const { migrateMcpAuthEntriesToSecretStorage } = await import(
      '@pivi/pivi-agent-core/mcp/oauth/mcpAuthEntryMigration'
    );
    const adapter = new MemoryVaultAdapter();
    const orphanDir = `${PIVI_MCP_OAUTH_DIR}/sha256-deadbeef`;
    await adapter.ensureFolder(PIVI_MCP_OAUTH_DIR);
    await adapter.ensureFolder(orphanDir);
    await adapter.write(`${orphanDir}/tokens.json`, JSON.stringify({
      tokens: { accessToken: 'orphan-token' },
    }));

    const secretStorage = {
      secrets: new Map<string, string>(),
      getSecret(id: string) {
        return this.secrets.get(id) ?? null;
      },
      setSecret(id: string, value: string) {
        if (!value) {
          this.secrets.delete(id);
          return;
        }
        this.secrets.set(id, value);
      },
      listSecrets(prefix: string) {
        return [...this.secrets.keys()].filter((id) => id.startsWith(prefix));
      },
    };

    const result = await migrateMcpAuthEntriesToSecretStorage(
      adapter as never,
      secretStorage,
      ['github'],
    );

    expect(result.migratedServerNames).toEqual([]);
    await expect(adapter.exists(`${orphanDir}/tokens.json`)).resolves.toBe(false);
    expect(secretStorage.secrets.size).toBe(0);
  });
});

describe('customProviderHeaderMigration', () => {
  it('moves header maps into SecretStorage and strips them from configs', async () => {
    const { migrateCustomProviderHeadersToSecretStorage } = await import(
      '@/app/settings/customProviderHeaderMigration'
    );
    const secretStorage = {
      secrets: new Map<string, string>(),
      getSecret(id: string) {
        return this.secrets.get(id) ?? null;
      },
      setSecret(id: string, value: string) {
        if (!value) {
          this.secrets.delete(id);
          return;
        }
        this.secrets.set(id, value);
      },
      listSecrets(prefix: string) {
        return [...this.secrets.keys()].filter((id) => id.startsWith(prefix));
      },
    };

    const migrated = migrateCustomProviderHeadersToSecretStorage(secretStorage, [{
      id: 'my-openai',
      kind: 'openai-compatible',
      name: 'My OpenAI',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      headers: {
        Authorization: 'Bearer secret-token',
        'X-Custom': 'value',
      },
      models: [],
    }]);

    expect(migrated[0]?.headers).toBeUndefined();
    const stored = parseCustomProviderHeaderSecret(
      secretStorage.getSecret(getCustomProviderHeaderSecretId('my-openai')),
    );
    expect(stored).toEqual({
      Authorization: 'Bearer secret-token',
      'X-Custom': 'value',
    });
  });

  it('merges stored header secrets into runtime custom provider configs', async () => {
    const { mergeCustomProviderHeaderSecrets } = await import(
      '@pivi/pivi-agent-core/auth/customProviderHeaderSecrets'
    );
    const secretStorage = {
      secrets: new Map<string, string>(),
      getSecret(id: string) {
        return this.secrets.get(id) ?? null;
      },
      setSecret(id: string, value: string) {
        if (!value) {
          this.secrets.delete(id);
          return;
        }
        this.secrets.set(id, value);
      },
      listSecrets(prefix: string) {
        return [...this.secrets.keys()].filter((id) => id.startsWith(prefix));
      },
    };
    writeCustomProviderHeaders(secretStorage, 'my-openai', {
      Authorization: 'Bearer runtime-token',
    });

    const merged = mergeCustomProviderHeaderSecrets(secretStorage, [{
      id: 'my-openai',
      kind: 'openai-compatible',
      name: 'My OpenAI',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      models: [],
    }]);

    expect(merged[0]?.headers).toEqual({ Authorization: 'Bearer runtime-token' });
  });
});
