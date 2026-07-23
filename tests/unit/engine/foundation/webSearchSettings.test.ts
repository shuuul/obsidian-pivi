import {
  DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
  getWebSearchToolsSettingsFromBag,
  resolveWebSearchToolsSettings,
  type WebSearchToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';

describe('resolveWebSearchToolsSettings', () => {
  it('returns an independent canonical default queue', () => {
    const resolved = resolveWebSearchToolsSettings(undefined);
    expect(resolved).toEqual({
      providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
      disabledProviders: [],
    });
    expect(resolved).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
    expect(resolved.providerOrder).not.toBe(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.providerOrder);
  });

  it('preserves order while removing duplicates and appending missing providers', () => {
    const raw = {
      providerOrder: ['exa', 'brave', 'exa'],
      disabledProviders: ['brave'],
    } as unknown as WebSearchToolsSettings;
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      providerOrder: ['exa', 'brave', 'tavily', 'anysearch'],
      disabledProviders: ['brave'],
    });
  });

  it('drops unknown and duplicate disabled provider ids', () => {
    const raw = {
      providerOrder: ['bogus', 'anysearch'],
      disabledProviders: ['bogus', 'exa', 'exa'],
    } as unknown as WebSearchToolsSettings;
    expect(resolveWebSearchToolsSettings(raw)).toEqual({
      providerOrder: ['anysearch', 'brave', 'tavily', 'exa'],
      disabledProviders: ['exa'],
    });
  });

  it('migrates explicit legacy search then fetch preferences into one order', () => {
    expect(resolveWebSearchToolsSettings({ searchProvider: 'exa', fetchProvider: 'tavily' })).toEqual({
      providerOrder: ['exa', 'tavily', 'brave', 'anysearch'],
      disabledProviders: [],
    });
  });

  it('ignores legacy auto and invalid provider values', () => {
    expect(resolveWebSearchToolsSettings({
      provider: 'auto',
      searchProvider: 'invalid',
      fetchProvider: 42,
    })).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });

  it('drops legacy fetchMode fields from persisted settings', () => {
    expect(resolveWebSearchToolsSettings({
      providerOrder: ['brave'],
      disabledProviders: [],
      fetchMode: 'direct-only',
    } as unknown as WebSearchToolsSettings)).toEqual({
      providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
      disabledProviders: [],
    });
  });
});

describe('getWebSearchToolsSettingsFromBag', () => {
  it('returns defaults when agent settings are absent or malformed', () => {
    expect(getWebSearchToolsSettingsFromBag({})).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
    expect(getWebSearchToolsSettingsFromBag({ agentSettings: 'oops' })).toEqual(DEFAULT_WEB_SEARCH_TOOLS_SETTINGS);
  });

  it('extracts and normalizes the canonical queue', () => {
    expect(getWebSearchToolsSettingsFromBag({
      agentSettings: {
        webSearchTools: {
          providerOrder: ['anysearch', 'tavily'],
          disabledProviders: ['tavily'],
        },
      },
    })).toEqual({
      providerOrder: ['anysearch', 'tavily', 'brave', 'exa'],
      disabledProviders: ['tavily'],
    });
  });
});
