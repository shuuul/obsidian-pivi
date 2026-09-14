import { configurePiAiModels } from '@pivi/engine-pi/piAiModels';
import { PI_AI_MODELS_CACHE } from '@pivi/engine-pi/piModelRegistry';
import { refreshPiCatalogModels } from '@pivi/engine-pi/piAiModels';
import {
  type RemoteCatalogEntry,
  type RemoteCatalogStore,
  withPiviRemoteCatalog,
} from '@pivi/engine-pi/remoteCatalog';
import { VERSION as PIVI_PI_VERSION } from '@pivi/engine-pi/shims/piCodingAgentConfig';
import type { Api, Model, Provider } from '@earendil-works/pi-ai';

function fakeModel(id: string, overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id,
    name: `Name ${id}`,
    api: 'openai-completions',
    provider: 'fakep',
    baseUrl: 'https://api.fake.test',
    reasoning: false,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    ...overrides,
  };
}

function createFakeProvider(models: Model<Api>[]): Provider {
  return {
    id: 'fakep',
    name: 'Fake',
    baseUrl: 'https://api.fake.test',
    auth: { apiKey: { resolve: async () => undefined } },
    getModels: () => models,
    stream: () => {
      throw new Error('not used');
    },
    streamSimple: () => {
      throw new Error('not used');
    },
  } as unknown as Provider;
}

class FakeStore implements RemoteCatalogStore {
  readonly entries = new Map<string, RemoteCatalogEntry>();

  read(providerId: string): RemoteCatalogEntry | undefined {
    return this.entries.get(providerId);
  }

  write(providerId: string, entry: RemoteCatalogEntry): void {
    this.entries.set(providerId, structuredClone(entry));
  }
}

type FetchCall = { url: string; init?: RequestInit };

function createFakeFetch(responses: Array<Response | Error>): {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input.toString(), init });
    const next = responses[index];
    index += 1;
    if (!next) throw new Error('Unexpected extra fetch call');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

function jsonResponse(payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('withPiviRemoteCatalog', () => {
  it('applies a fresh catalog overlay, replacing by id and appending new models', async () => {
    const baseline = [fakeModel('m1'), fakeModel('m2')];
    const store = new FakeStore();
    const { fetch } = createFakeFetch([
      jsonResponse({ 'm1': fakeModel('m1', { name: 'Fresh m1' }), 'm3': fakeModel('m3') }, {
        'last-modified': 'Fri, 11 Sep 2026 10:27:53 GMT',
        etag: '"v2"',
      }),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store,
    });

    const result = await wrapped.refresh({ force: true });

    expect(result).toEqual({
      status: 'updated',
      addedModels: 1,
      updatedModels: 1,
      totalModels: 3,
    });
    const merged = wrapped.provider.getModels();
    expect(merged.map((model) => model.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged.find((model) => model.id === 'm1')?.name).toBe('Fresh m1');
    // Baseline entries the catalog dropped stay resolvable for old sessions.
    expect(merged.find((model) => model.id === 'm2')).toBeDefined();
    const stored = store.read('fakep');
    expect(stored?.models).toHaveLength(2);
    expect(stored?.etag).toBe('"v2"');
    expect(stored?.piVersion).toBe(PIVI_PI_VERSION);
  });

  it('drops malformed and engine-incompatible entries instead of failing', async () => {
    const baseline = [fakeModel('m1')];
    const { fetch } = createFakeFetch([
      jsonResponse([
        fakeModel('ok'),
        { id: 'no-window', name: 'x', api: 'openai-completions' },
        fakeModel('bad-api', { api: 'future-api' as Api }),
        { id: 42 },
        null,
        'junk',
      ]),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store: new FakeStore(),
    });

    const result = await wrapped.refresh({ force: true });

    expect(result).toEqual({
      status: 'updated',
      addedModels: 1,
      updatedModels: 0,
      totalModels: 2,
    });
    expect(wrapped.provider.getModels().map((model) => model.id)).toEqual(['m1', 'ok']);
  });

  it('clears the overlay and marks the provider unavailable on 404', async () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    const { fetch } = createFakeFetch([
      jsonResponse([fakeModel('remote')]),
      new Response(null, { status: 404 }),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store,
    });
    await wrapped.refresh({ force: true });
    expect(wrapped.provider.getModels().some((model) => model.id === 'remote')).toBe(true);

    const result = await wrapped.refresh({ force: true });

    expect(result).toEqual({
      status: 'unavailable',
      addedModels: 0,
      updatedModels: 0,
      totalModels: 1,
    });
    expect(wrapped.provider.getModels().some((model) => model.id === 'remote')).toBe(false);
    expect(store.read('fakep')?.lastModified).toBe(0);
  });

  it('keeps the cached overlay on a 304 and revalidates with the stored etag', async () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    const { fetch, calls } = createFakeFetch([
      jsonResponse([fakeModel('remote')], { etag: '"v1"' }),
      new Response(null, { status: 304 }),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store,
    });
    await wrapped.refresh({ force: true });

    const result = await wrapped.refresh({ force: true });

    expect(result.status).toBe('current');
    expect(wrapped.provider.getModels().some((model) => model.id === 'remote')).toBe(true);
    expect(calls[1]?.init?.headers).toMatchObject({ 'if-none-match': '"v1"' });
  });

  it('skips network inside the freshness window unless forced', async () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    const { fetch, calls } = createFakeFetch([
      jsonResponse([fakeModel('remote')]),
      jsonResponse([fakeModel('remote-2')]),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store,
    });
    await wrapped.refresh({ force: true });

    const throttled = await wrapped.refresh({});
    expect(throttled.status).toBe('current');
    expect(calls).toHaveLength(1);

    const forced = await wrapped.refresh({ force: true });
    expect(forced.status).toBe('updated');
    expect(calls).toHaveLength(2);
  });

  it('retains the last good overlay when the refresh fails transiently', async () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    const { fetch } = createFakeFetch([
      jsonResponse([fakeModel('remote')]),
      new Response(null, { status: 503 }),
    ]);
    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), {
      fetch,
      store,
    });
    await wrapped.refresh({ force: true });

    await expect(wrapped.refresh({ force: true })).rejects.toThrow('503');

    expect(wrapped.provider.getModels().some((model) => model.id === 'remote')).toBe(true);
    expect(store.read('fakep')?.models).toHaveLength(1);
  });

  it('discards stored overlays recorded for a different Pi pin', () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    store.write('fakep', {
      models: [fakeModel('stale-overlay')],
      checkedAt: 1,
      lastModified: 2,
      piVersion: '0.0.1-test',
    });

    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), { store });

    expect(wrapped.provider.getModels().map((model) => model.id)).toEqual(['m1']);
  });

  it('reports skipped when no fetch is configured and restores no overlay without a version', () => {
    const baseline = [fakeModel('m1')];
    const store = new FakeStore();
    store.write('fakep', {
      models: [fakeModel('orphan')],
      checkedAt: 1,
      lastModified: 2,
      piVersion: '',
    });

    const wrapped = withPiviRemoteCatalog(createFakeProvider(baseline), { store });

    expect(wrapped.provider.getModels().map((model) => model.id)).toEqual(['m1']);
    return expect(wrapped.refresh({ force: true })).resolves.toEqual({
      status: 'skipped',
      addedModels: 0,
      updatedModels: 0,
      totalModels: 1,
    });
  });
});

describe('refreshPiCatalogModels orchestration', () => {
  const storedEntries = new Map<string, RemoteCatalogEntry>();
  const catalogStore: RemoteCatalogStore = {
    read: (providerId) => storedEntries.get(providerId),
    write: (providerId, entry) => {
      storedEntries.set(providerId, structuredClone(entry));
    },
  };
  // The Jest pi-ai mock only bundles anthropic-messages models, so the
  // engine-compatibility guard accepts that api in this fixture.
  const deepseekPayload = {
    'deepseek-v4-flash': {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4.1 Flash',
      api: 'anthropic-messages',
      baseUrl: 'https://api.deepseek.com',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0.3, output: 1.2 },
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    },
  };

  afterEach(() => {
    storedEntries.clear();
    configurePiAiModels({});
  });

  it('force-refreshes one provider and publishes the refreshed registry cache', async () => {
    const { fetch, calls } = createFakeFetch([jsonResponse(deepseekPayload)]);
    configurePiAiModels({ providerFetch: fetch, catalogStore });

    const summary = await refreshPiCatalogModels({ providerIds: ['deepseek'], force: true });

    expect(summary.failures).toEqual([]);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({
      providerId: 'deepseek',
      status: 'updated',
      addedModels: 1,
    });
    expect(calls[0]?.url).toBe('https://pi.dev/api/models/providers/deepseek');
    expect(PI_AI_MODELS_CACHE.get('deepseek/deepseek-v4-flash')?.name).toBe('DeepSeek V4.1 Flash');
  });

  it('collects per-provider failures without throwing', async () => {
    const { fetch } = createFakeFetch([new Response(null, { status: 500 })]);
    configurePiAiModels({ providerFetch: fetch, catalogStore });

    const summary = await refreshPiCatalogModels({ providerIds: ['deepseek'], force: true });

    expect(summary.results).toEqual([]);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]?.providerId).toBe('deepseek');
    expect(summary.failures[0]?.message).toContain('500');
  });

  it('returns an empty summary for unknown provider ids', async () => {
    configurePiAiModels({ providerFetch: createFakeFetch([]).fetch, catalogStore });

    const summary = await refreshPiCatalogModels({ providerIds: ['not-a-provider'], force: true });

    expect(summary).toEqual({ results: [], failures: [] });
  });
});
