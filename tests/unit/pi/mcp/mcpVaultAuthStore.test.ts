import { createHash } from 'crypto';

import { PIVI_MCP_OAUTH_DIR } from '@pivi/pivi-agent-core/mcp/paths';
import { McpVaultAuthStore } from '@pivi/pivi-agent-core/mcp/oauth/mcpVaultAuthStore';

function entryPath(serverName: string): string {
  const storageKey = createHash('sha256').update(serverName, 'utf8').digest('hex');
  return `${PIVI_MCP_OAUTH_DIR}/sha256-${storageKey}/tokens.json`;
}

class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
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

  async deleteFolder(): Promise<void> {
    // no-op for memory adapter
  }

  async ensureFolder(): Promise<void> {
    // no-op
  }
}

describe('McpVaultAuthStore', () => {
  let adapter: MemoryVaultAdapter;
  let store: McpVaultAuthStore;

  beforeEach(() => {
    adapter = new MemoryVaultAdapter();
    store = new McpVaultAuthStore(adapter as never);
  });

  it('stores and reads tokens scoped to server URL', async () => {
    await store.updateTokens('github', {
      accessToken: 'token-a',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }, 'https://mcp.example.com');

    const entry = await store.getAuthForUrl('github', 'https://mcp.example.com');
    expect(entry?.tokens?.accessToken).toBe('token-a');

    const wrongUrl = await store.getAuthForUrl('github', 'https://other.example.com');
    expect(wrongUrl).toBeUndefined();

    const persisted = await store.getEntry('github');
    expect(persisted?.serverUrl).toBe('https://mcp.example.com');
  });

  it('getEntry returns undefined when the tokens file is missing', async () => {
    await expect(store.getEntry('missing-server')).resolves.toBeUndefined();
  });

  it('getEntry returns undefined when tokens file content is not valid JSON', async () => {
    await adapter.write(entryPath('corrupt'), 'not-json{{{');
    await expect(store.getEntry('corrupt')).resolves.toBeUndefined();
  });

  it.each([
    ['null', 'null'],
    ['string', '"hello"'],
    ['number', '42'],
    ['boolean', 'true'],
  ])('getEntry returns undefined when parsed JSON is %s', async (_label, raw) => {
    await adapter.write(entryPath('non-object'), raw);
    await expect(store.getEntry('non-object')).resolves.toBeUndefined();
  });

  it('getAuthForUrl returns undefined when entry has no serverUrl', async () => {
    await store.saveEntry('github', {
      tokens: { accessToken: 'token-a' },
    });

    await expect(
      store.getAuthForUrl('github', 'https://mcp.example.com'),
    ).resolves.toBeUndefined();
  });

  it('getAuthForUrl returns undefined when stored serverUrl does not match', async () => {
    await store.saveEntry('github', {
      tokens: { accessToken: 'token-a' },
      serverUrl: 'https://stored.example.com',
    });

    await expect(
      store.getAuthForUrl('github', 'https://requested.example.com'),
    ).resolves.toBeUndefined();
  });

  it('removeEntry deletes stored tokens', async () => {
    await store.updateTokens('github', {
      accessToken: 'token-a',
    }, 'https://mcp.example.com');

    await store.removeEntry('github');

    await expect(store.getEntry('github')).resolves.toBeUndefined();
  });

  it('updateTokens replaces tokens and clears OAuth flow fields when serverUrl changes', async () => {
    await store.saveEntry('github', {
      tokens: { accessToken: 'old-token' },
      clientInfo: { clientId: 'client-id' },
      codeVerifier: 'pkce-verifier',
      oauthState: 'oauth-state',
      serverUrl: 'https://old.example.com',
    });

    await store.updateTokens('github', {
      accessToken: 'new-token',
      refreshToken: 'refresh-token',
    }, 'https://new.example.com');

    const entry = await store.getEntry('github');
    expect(entry?.tokens).toEqual({
      accessToken: 'new-token',
      refreshToken: 'refresh-token',
    });
    expect(entry?.clientInfo).toBeUndefined();
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.oauthState).toBeUndefined();
    expect(entry?.serverUrl).toBe('https://new.example.com');
  });
});
