import { writeCustomProviderHeaders } from '@pivi/agent/auth/customProviderHeaderSecrets';

describe('custom provider header secrets', () => {
  it('merges stored header secrets into runtime custom provider configs', async () => {
    const { mergeCustomProviderHeaderSecrets } = await import(
      '@pivi/agent/auth/customProviderHeaderSecrets'
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

  it('uses digest-based header secret ids for long custom provider ids', async () => {
    const { getCustomProviderHeaderSecretId } = await import(
      '@pivi/agent/auth/customProviderHeaderSecrets'
    );
    const { MAX_OBSIDIAN_SECRET_ID_LENGTH } = await import(
      '@pivi/agent/auth/providerSecretStorage'
    );
    const providerId = 'custom-openai-compatible-369e807a-7e24-4204-a86d-3abbaaa3d1e2';
    const secretId = getCustomProviderHeaderSecretId(providerId);
    expect(secretId.length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
    expect(secretId).toMatch(/^pivi-cph-[0-9a-f]{16}-v1$/);
  });
});
