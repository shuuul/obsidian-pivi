import {
  FORMER_SETTINGS_SEARCH_KEYS,
  RETIRED_SETTINGS_TAB_SEARCH_KEYS,
  SETTINGS_PAGES,
  type SettingsPageId,
} from '@pivi/pivi-react/settings';

const PAGE_IDS: readonly SettingsPageId[] = [
  'general',
  'appearance',
  'chat',
  'personalization',
  'input',
  'sessions',
  'about',
  'environment',
  'models',
  'builtInTools',
  'webTools',
  'mcpServers',
  'skills',
  'prompt',
  'commands',
  'toolbar',
];

describe('settings page search alias partition', () => {
  it('owns every former search key exactly once after retiring tab keys', () => {
    const retired = new Set<string>(RETIRED_SETTINGS_TAB_SEARCH_KEYS);
    const formerRemaining = FORMER_SETTINGS_SEARCH_KEYS.filter((key) => !retired.has(key));
    const owned = Object.values(SETTINGS_PAGES).flatMap((page) => [...page.aliasKeys]);

    expect(new Set(owned).size).toBe(owned.length);
    expect(owned).toEqual(expect.arrayContaining([...formerRemaining]));
    for (const key of formerRemaining) {
      expect(owned.filter((ownedKey) => ownedKey === key)).toHaveLength(1);
    }
  });

  it('gives every settings page at least one alias key', () => {
    expect(Object.keys(SETTINGS_PAGES)).toEqual(PAGE_IDS);
    for (const id of PAGE_IDS) {
      expect(SETTINGS_PAGES[id].aliasKeys.length).toBeGreaterThan(0);
    }
  });
});
