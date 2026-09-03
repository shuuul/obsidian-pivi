import { createI18n } from '@pivi/pivi-react';
import { getSettingsPageSearchAliases, mountSettingsPage } from '@pivi/pivi-react/mount';
import { SETTINGS_ROOT_LAYOUT } from '@pivi/pivi-react/settings';

import type { PiviPluginHost, PiviPluginWorkspace } from '@/app/hostContracts';
import { appI18n } from '@/app/i18n';
import { PiviSettingTabHost } from '@/app/ui/PiviSettingTabHost';
import { createSettingsUiPorts } from '@/app/ui/createUiPorts';

jest.mock('@/app/ui/createUiPorts', () => ({
  createSettingsUiPorts: jest.fn(() => ({})),
}));

jest.mock('@pivi/pivi-react/mount', () => {
  const actual = jest.requireActual<typeof import('@pivi/pivi-react/mount')>('@pivi/pivi-react/mount');
  return {
    ...actual,
    mountSettingsPage: jest.fn(),
  };
});

const mockedMountSettingsPage = jest.mocked(mountSettingsPage);
const mockedCreateSettingsUiPorts = jest.mocked(createSettingsUiPorts);
const registeredCleanups: Array<() => void> = [];

function flushMount(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHost(locale = 'en') {
  const cleanups: Array<() => void> = [];
  const plugin = {
    manifest: { name: 'Pivi', description: 'Pivi settings' },
    register: (cleanup: () => void) => {
      cleanups.push(cleanup);
      registeredCleanups.push(cleanup);
    },
    settings: { locale },
  } as unknown as PiviPluginHost;
  const workspace = {} as PiviPluginWorkspace;
  const getWorkspace = jest.fn(async () => workspace);
  const host = new PiviSettingTabHost({} as never, plugin, getWorkspace);
  host.containerEl = document.createElement('div');
  return { cleanups, getWorkspace, host, plugin, workspace };
}

function isPage(item: unknown): item is { type: 'page'; name: string; desc?: string; items?: unknown[] } {
  return typeof item === 'object' && item !== null && 'type' in item && (item as { type: unknown }).type === 'page';
}

function isGroup(item: unknown): item is { type: 'group'; heading?: string; items?: unknown[] } {
  return typeof item === 'object' && item !== null && 'type' in item && (item as { type: unknown }).type === 'group';
}

function isRenderItem(item: unknown): item is {
  name: string;
  desc?: string;
  aliases?: string[];
  render: (setting: { settingEl: HTMLElement }, group: object) => void | (() => void);
} {
  return typeof item === 'object'
    && item !== null
    && 'render' in item
    && typeof (item as { render: unknown }).render === 'function';
}

function collectPages(items: unknown[]): Array<{ type: 'page'; name: string; desc?: string; items?: unknown[] }> {
  const pages: Array<{ type: 'page'; name: string; desc?: string; items?: unknown[] }> = [];
  for (const item of items) {
    if (isPage(item)) pages.push(item);
    if (isGroup(item) && item.items) pages.push(...collectPages(item.items));
  }
  return pages;
}

type RenderItem = {
  name: string;
  desc?: string;
  aliases?: string[];
  render: (setting: { settingEl: HTMLElement }, group: object) => void | (() => void);
};

function collectRenderItems(items: unknown[]): RenderItem[] {
  const renders: RenderItem[] = [];
  for (const item of items) {
    if (isRenderItem(item)) renders.push(item);
    if (isPage(item) && item.items) renders.push(...collectRenderItems(item.items));
    if (isGroup(item) && item.items) renders.push(...collectRenderItems(item.items));
  }
  return renders;
}

describe('settings page search aliases', () => {
  it('returns unique localized aliases for a page, excluding the page label', () => {
    const i18n = createI18n('en');
    const general = getSettingsPageSearchAliases(i18n, 'general');
    expect(general).toEqual(expect.arrayContaining([
      'Language',
      'Show cache hit rate',
      'Show tokens per second',
      'About',
    ]));
    expect(general).not.toContain('General');
    expect(new Set(general).size).toBe(general.length);
    expect(getSettingsPageSearchAliases(i18n, 'webTools')).toEqual(expect.arrayContaining([
      'Brave Search',
      'Tavily',
      'Exa',
      'AnySearch',
    ]));

    i18n.setLocale('zh-CN');
    expect(getSettingsPageSearchAliases(i18n, 'models')).toEqual(expect.arrayContaining([
      '+ 添加提供商',
    ]));
    expect(getSettingsPageSearchAliases(i18n, 'models')).not.toContain('模型');
  });
});

describe('PiviSettingTabHost', () => {
  beforeEach(() => {
    mockedCreateSettingsUiPorts.mockClear();
    mockedMountSettingsPage.mockReset();
    appI18n.setLocale('en');
  });

  afterEach(() => {
    registeredCleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('returns the exact root layout order and item types', () => {
    const { host } = createHost();
    const definitions = host.getSettingDefinitions();
    expect(definitions).toHaveLength(SETTINGS_ROOT_LAYOUT.length);

    expect(isRenderItem(definitions[0])).toBe(true);
    expect(definitions[0]).toMatchObject({
      name: 'General',
      desc: expect.any(String),
    });

    expect(isPage(definitions[1])).toBe(true);
    expect(definitions[1]).toMatchObject({ type: 'page', name: 'Models' });

    expect(isGroup(definitions[2])).toBe(true);
    expect(definitions[2]).toMatchObject({ type: 'group', heading: 'Agent' });
    const agentItems = isGroup(definitions[2]) ? definitions[2].items ?? [] : [];
    expect(agentItems.map((item) => isPage(item) ? item.name : null)).toEqual([
      'Built-in tools',
      'Web tools',
      'MCP servers',
      'Skills',
      'Prompt',
    ]);

    expect(isGroup(definitions[3])).toBe(true);
    expect(definitions[3]).toMatchObject({ type: 'group', heading: 'Editor' });
    const editorItems = isGroup(definitions[3]) ? definitions[3].items ?? [] : [];
    expect(editorItems.map((item) => isPage(item) ? item.name : null)).toEqual([
      'Commands',
      'Toolbar',
    ]);

    expect(isPage(definitions[4])).toBe(true);
    expect(definitions[4]).toMatchObject({ type: 'page', name: 'Environment' });
  });

  it('gives every page exactly one render item with name, desc, and aliases', () => {
    const { host } = createHost();
    const pages = collectPages(host.getSettingDefinitions());
    expect(pages.length).toBe(9);
    for (const page of pages) {
      expect(page.name.length).toBeGreaterThan(0);
      expect(typeof page.desc === 'string' && page.desc.length > 0).toBe(true);
      expect(page.items).toHaveLength(1);
      const item = page.items?.[0];
      if (!isRenderItem(item)) {
        throw new Error(`Expected a render item inside ${page.name}`);
      }
      expect(item.name.length).toBeGreaterThan(0);
      expect(typeof item.desc === 'string' && item.desc.length > 0).toBe(true);
      expect(item.aliases && item.aliases.length > 0).toBe(true);
    }
  });

  it('has no own display method', () => {
    expect(Object.hasOwn(PiviSettingTabHost.prototype, 'display')).toBe(false);
  });

  it('mounts a page through its render item and cleans it up', async () => {
    const dispose = jest.fn(async () => undefined);
    mockedMountSettingsPage.mockImplementation(async (options) => {
      options.container.setAttribute('data-pivi-settings-page', options.page);
      return { dispose };
    });
    const { host, plugin, workspace } = createHost();
    const models = host.getSettingDefinitions()[1];
    if (!isPage(models) || !isRenderItem(models.items?.[0])) {
      throw new Error('Expected Models page render item');
    }
    const settingEl = document.createElement('div');
    const cleanup = models.items[0].render({ settingEl }, {});
    await flushMount();

    expect(mockedCreateSettingsUiPorts).toHaveBeenCalledWith(plugin, workspace);
    expect(mockedMountSettingsPage).toHaveBeenCalledWith(expect.objectContaining({
      page: 'models',
      container: settingEl,
      ownerDocument: document,
      ownerWindow: window,
    }));
    expect(settingEl).toHaveClass('pivi-settings-definition-host');
    expect(settingEl.getAttribute('data-pivi-settings-page')).toBe('models');
    expect(cleanup).toEqual(expect.any(Function));
    cleanup?.();
    await flushMount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(settingEl).toBeEmptyDOMElement();
  });

  it('tags the implicit single-item host surface for CSS reset', () => {
    mockedMountSettingsPage.mockResolvedValue({ dispose: jest.fn(async () => undefined) });
    const { host } = createHost();
    const models = host.getSettingDefinitions()[1];
    if (!isPage(models) || !isRenderItem(models.items?.[0])) {
      throw new Error('Expected Models page render item');
    }
    const items = document.createElement('div');
    const search = document.createElement('div');
    search.className = 'setting-group-search';
    const settingEl = document.createElement('div');
    items.append(settingEl);
    const group = document.createElement('div');
    group.append(search, items);

    models.items[0].render({ settingEl }, {});

    expect(items).toHaveClass('pivi-settings-host-surface-reset');
    expect(search).toHaveClass('pivi-settings-host-surface-reset');
  });

  it('does not tag a host surface that already wraps multiple items', () => {
    mockedMountSettingsPage.mockResolvedValue({ dispose: jest.fn(async () => undefined) });
    const { host } = createHost();
    const models = host.getSettingDefinitions()[1];
    if (!isPage(models) || !isRenderItem(models.items?.[0])) {
      throw new Error('Expected Models page render item');
    }
    const items = document.createElement('div');
    const settingEl = document.createElement('div');
    items.append(settingEl, document.createElement('div'));

    models.items[0].render({ settingEl }, {});

    expect(items).not.toHaveClass('pivi-settings-host-surface-reset');
  });

  it('mounts general content through the render item and cleans it up', async () => {
    const dispose = jest.fn(async () => undefined);
    mockedMountSettingsPage.mockResolvedValue({ dispose });
    const { host, plugin, workspace } = createHost();
    const definitions = host.getSettingDefinitions();
    const generalContent = definitions[0];
    if (!isRenderItem(generalContent)) {
      throw new Error('Expected general content render definition');
    }
    const settingEl = document.createElement('div');
    const cleanup = generalContent.render({ settingEl }, {});
    await flushMount();

    expect(mockedCreateSettingsUiPorts).toHaveBeenCalledWith(plugin, workspace);
    expect(mockedMountSettingsPage).toHaveBeenCalledWith(expect.objectContaining({
      page: 'general',
      container: settingEl,
    }));
    expect(settingEl).toHaveClass('pivi-settings-definition-host');
    cleanup?.();
    await flushMount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(settingEl).toBeEmptyDOMElement();
  });

  it('refreshes the declarative index after a locale change', () => {
    const { cleanups, host } = createHost();
    const update = jest.fn();
    Object.defineProperty(host, 'update', { configurable: true, value: update });

    appI18n.setLocale('zh-CN');
    expect(update).toHaveBeenCalledTimes(1);
    const definitions = host.getSettingDefinitions();
    expect(definitions[0]).toMatchObject({ name: '通用' });

    cleanups.forEach((cleanup) => cleanup());
    appI18n.setLocale('en');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('disposes live surfaces on unload', async () => {
    const dispose = jest.fn(async () => undefined);
    mockedMountSettingsPage.mockResolvedValue({ dispose });
    const { cleanups, host } = createHost();
    const renders = collectRenderItems(host.getSettingDefinitions());
    const first = renders[0];
    if (!first) throw new Error('Expected a render item');
    first.render({ settingEl: document.createElement('div') }, {});
    await flushMount();
    expect(mockedMountSettingsPage).toHaveBeenCalled();

    cleanups.forEach((cleanup) => cleanup());
    await flushMount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
