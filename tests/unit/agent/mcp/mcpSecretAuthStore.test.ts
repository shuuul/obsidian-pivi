import { SecretStorage } from 'obsidian';

import { McpSecretAuthStore } from '@pivi/agent/mcp/oauth/mcpSecretAuthStore';

describe('McpSecretAuthStore', () => {
  it('saves entries under the plain server-name id', async () => {
    const secretStorage = new SecretStorage();
    const store = new McpSecretAuthStore(secretStorage);

    await store.saveEntry('deepwiki', { tokens: { accessToken: 'token-1' } });

    expect(secretStorage.getSecret('pivi-mcp-deepwiki-oauth-v1')).toContain('token-1');
    expect(await store.getEntry('deepwiki')).toMatchObject({
      tokens: { accessToken: 'token-1' },
    });
  });

  it('migrates legacy hex-encoded entries onto the plain id on read', async () => {
    const secretStorage = new SecretStorage();
    const legacyId = 'pivi-mcp-oauth-6465657077696b69-auth-v1';
    secretStorage.setSecret(
      legacyId,
      JSON.stringify({
        version: 1,
        entry: { tokens: { accessToken: 'legacy-token' }, serverUrl: 'https://mcp.deepwiki.test' },
      }),
    );
    const store = new McpSecretAuthStore(secretStorage);

    expect(await store.getEntry('deepwiki')).toMatchObject({
      tokens: { accessToken: 'legacy-token' },
      serverUrl: 'https://mcp.deepwiki.test',
    });
    expect(secretStorage.getSecret('pivi-mcp-deepwiki-oauth-v1')).toContain('legacy-token');
    expect(secretStorage.getSecret(legacyId)).toBeNull();
  });

  it('retires legacy ids when saving over them', async () => {
    const secretStorage = new SecretStorage();
    const legacyId = 'pivi-mcp-oauth-6465657077696b69-auth-v1';
    secretStorage.setSecret(
      legacyId,
      JSON.stringify({ version: 1, entry: { tokens: { accessToken: 'stale' } } }),
    );
    const store = new McpSecretAuthStore(secretStorage);

    await store.saveEntry('deepwiki', { tokens: { accessToken: 'fresh' } });

    expect(secretStorage.getSecret('pivi-mcp-deepwiki-oauth-v1')).toContain('fresh');
    expect(secretStorage.getSecret(legacyId)).toBeNull();
  });

  it('falls back to the digest id for non-keychain-safe server names', async () => {
    const secretStorage = new SecretStorage();
    const store = new McpSecretAuthStore(secretStorage);

    await store.saveEntry('api.example.com', { tokens: { accessToken: 'token-2' } });

    const savedId = secretStorage.listSecrets()[0]!;
    expect(savedId).toMatch(/^pivi-mcp-oauth-d-[0-9a-f]{16}-auth-v1$/);
    expect(await store.getEntry('api.example.com')).toMatchObject({
      tokens: { accessToken: 'token-2' },
    });
  });
});

describe('McpSecretAuthStore server URL scoping', () => {
  let store: McpSecretAuthStore;

  beforeEach(() => {
    store = new McpSecretAuthStore(new SecretStorage());
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
