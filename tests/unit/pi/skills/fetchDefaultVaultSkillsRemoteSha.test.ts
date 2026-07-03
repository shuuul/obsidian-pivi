import type { HttpClient, HttpRequest, HttpResponse } from '@pivi/pivi-agent-core/ports';
import { DEFAULT_VAULT_SKILLS_COMMITS_URL } from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from '@pivi/pivi-agent-core/skills/vault/fetchDefaultVaultSkillsRemoteSha';

function createHttpResponse(
  status: number,
  jsonBody: unknown,
  options: { ok?: boolean } = {},
): HttpResponse {
  const ok = options.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    headers: {},
    text: async () => JSON.stringify(jsonBody),
    json: async <T = unknown>() => jsonBody as T,
  };
}

function mockHttpClient(
  handler: (request: HttpRequest) => Promise<HttpResponse>,
): HttpClient {
  return {
    fetch: jest.fn(handler),
  };
}

describe('fetchDefaultVaultSkillsRemoteSha', () => {
  it('returns commit sha when HttpClient responds with ok and a non-empty sha', async () => {
    const httpClient = mockHttpClient(async () =>
      createHttpResponse(200, { sha: 'abc123def456' }),
    );

    await expect(fetchDefaultVaultSkillsRemoteSha(httpClient)).resolves.toBe('abc123def456');

    expect(httpClient.fetch).toHaveBeenCalledWith({
      url: DEFAULT_VAULT_SKILLS_COMMITS_URL,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pivi-obsidian-plugin',
      },
    });
  });

  it('returns null when response is not ok', async () => {
    const httpClient = mockHttpClient(async () =>
      createHttpResponse(404, { message: 'Not Found' }, { ok: false }),
    );

    await expect(fetchDefaultVaultSkillsRemoteSha(httpClient)).resolves.toBeNull();
  });

  it.each([
    { label: 'missing sha', body: {} },
    { label: 'empty sha', body: { sha: '' } },
    { label: 'non-string sha', body: { sha: 42 } },
  ])('returns null for malformed body ($label)', async ({ body }) => {
    const httpClient = mockHttpClient(async () => createHttpResponse(200, body));

    await expect(fetchDefaultVaultSkillsRemoteSha(httpClient)).resolves.toBeNull();
  });

  it('returns null when json() rejects', async () => {
    const httpClient = mockHttpClient(async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: async () => 'not json',
      json: async () => {
        throw new Error('invalid json');
      },
    }));

    await expect(fetchDefaultVaultSkillsRemoteSha(httpClient)).resolves.toBeNull();
  });

  it('returns null when HttpClient.fetch throws', async () => {
    const httpClient = mockHttpClient(async () => {
      throw new Error('connection refused');
    });

    await expect(fetchDefaultVaultSkillsRemoteSha(httpClient)).resolves.toBeNull();
  });
});