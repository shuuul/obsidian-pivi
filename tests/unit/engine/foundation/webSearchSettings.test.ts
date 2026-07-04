import {
  DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
  getWebSearchToolsSettingsFromBag,
  resolveWebSearchToolsSettings,
  type WebSearchToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';

describe('resolveWebSearchToolsSettings', () => {
  it('returns defaults when raw is undefined', () => {
    expect(resolveWebSearchToolsSettings(undefined)).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
    expect(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS).toEqual({
      searchProvider: 'auto',
      fetchProvider: 'auto',
    });
  });

  it('preserves valid search and fetch provider choices independently', () => {
    const raw: WebSearchToolsSettings = { searchProvider: 'tavily', fetchProvider: 'exa' };
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      searchProvider: 'tavily',
      fetchProvider: 'exa',
    });
  });

  it('preserves auto for both providers', () => {
    const raw: WebSearchToolsSettings = { searchProvider: 'auto', fetchProvider: 'auto' };
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      searchProvider: 'auto',
      fetchProvider: 'auto',
    });
  });

  it('normalizes invalid searchProvider to default', () => {
    const raw = { searchProvider: 'google', fetchProvider: 'tavily' } as unknown as WebSearchToolsSettings;
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      searchProvider: 'auto',
      fetchProvider: 'tavily',
    });
  });

  it('normalizes invalid fetchProvider to default', () => {
    const raw = { searchProvider: 'brave', fetchProvider: 'bing' } as unknown as WebSearchToolsSettings;
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      searchProvider: 'brave',
      fetchProvider: 'auto',
    });
  });

  it('migrates legacy provider to searchProvider with fetchProvider auto', () => {
    expect(resolveWebSearchToolsSettings({ provider: 'exa' })).toEqual({
      searchProvider: 'exa',
      fetchProvider: 'auto',
    });
  });

  it('does not retain legacy provider field in resolved settings', () => {
    const resolved = resolveWebSearchToolsSettings({ provider: 'tavily' });
    expect(resolved).toEqual({ searchProvider: 'tavily', fetchProvider: 'auto' });
    expect('provider' in resolved).toBe(false);
  });

  it('prefers explicit searchProvider over legacy provider', () => {
    expect(
      resolveWebSearchToolsSettings({ provider: 'brave', searchProvider: 'exa' }),
    ).toEqual({ searchProvider: 'exa', fetchProvider: 'auto' });
  });

  it('handles fully malformed input', () => {
    const raw = { searchProvider: 42, fetchProvider: null, provider: 42 } as unknown as WebSearchToolsSettings;
    expect(resolveWebSearchToolsSettings(raw)).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });
});

describe('getWebSearchToolsSettingsFromBag', () => {
  it('returns defaults when agentSettings is missing', () => {
    expect(getWebSearchToolsSettingsFromBag({})).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });

  it('returns defaults when webSearchTools is missing', () => {
    expect(getWebSearchToolsSettingsFromBag({ agentSettings: {} })).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });

  it('extracts and normalizes providers from the bag', () => {
    const bag = {
      agentSettings: {
        webSearchTools: { searchProvider: 'exa', fetchProvider: 'tavily' },
      },
    };
    expect(getWebSearchToolsSettingsFromBag(bag)).toEqual({
      searchProvider: 'exa',
      fetchProvider: 'tavily',
    });
  });

  it('migrates legacy provider in the bag', () => {
    const bag = {
      agentSettings: {
        webSearchTools: { provider: 'brave' },
      },
    };
    expect(getWebSearchToolsSettingsFromBag(bag)).toEqual({
      searchProvider: 'brave',
      fetchProvider: 'auto',
    });
  });

  it('normalizes malformed providers in the bag', () => {
    const bag = {
      agentSettings: {
        webSearchTools: { searchProvider: 'invalid', fetchProvider: 'invalid' },
      },
    };
    expect(getWebSearchToolsSettingsFromBag(bag)).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });

  it('returns defaults for malformed agentSettings', () => {
    expect(getWebSearchToolsSettingsFromBag({ agentSettings: 'oops' })).toEqual(
      DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
    );
  });
});