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
