import { createI18n } from '@pivi/pivi-react';
import { getSettingsSearchAliases, mountSettings } from '@pivi/pivi-react/mount';

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
    mountSettings: jest.fn(),
  };
});

const mockedMountSettings = jest.mocked(mountSettings);
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

describe('settings search metadata', () => {
  it('provides localized, unique aliases for all setting sections', () => {
    const i18n = createI18n('en');
    const english = getSettingsSearchAliases(i18n);
    expect(english).toEqual(expect.arrayContaining([
      'General',
      'Models',
      'Skills',
      'Tools',
      'Subagents',
      'Commands',
      'Language',
    ]));
    expect(new Set(english).size).toBe(english.length);

    i18n.setLocale('zh-CN');
    expect(getSettingsSearchAliases(i18n)).toEqual(expect.arrayContaining([
      '通用',
      '模型',
      '技能',
      '工具',
      '子代理',
      '命令',
      '语言',
    ]));
  });
});

describe('PiviSettingTabHost', () => {
  beforeEach(() => {
    mockedCreateSettingsUiPorts.mockClear();
    mockedMountSettings.mockReset();
    appI18n.setLocale('en');
  });

  afterEach(() => {
    registeredCleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('exposes a localized custom definition and cleans up its React mount', async () => {
    const dispose = jest.fn(async () => undefined);
    mockedMountSettings.mockResolvedValue({ dispose });
    const { host, plugin, workspace } = createHost();
    const definition = host.getSettingDefinitions()[0];
    const settingEl = document.createElement('div');

    expect(definition).toMatchObject({
      name: 'Pivi',
      desc: 'Pivi settings',
      aliases: expect.arrayContaining(['General', 'Models', 'Tools']),
    });
    if (!definition || !('render' in definition) || !definition.render) {
      throw new Error('Expected a render definition');
    }
    const cleanup = definition.render({ settingEl } as never, {} as never);
    await flushMount();

    expect(mockedCreateSettingsUiPorts).toHaveBeenCalledWith(plugin, workspace);
    expect(mockedMountSettings).toHaveBeenCalledWith(expect.objectContaining({
      container: settingEl,
      ownerDocument: document,
      ownerWindow: window,
    }));
    expect(settingEl).toHaveClass('pivi-settings-definition-host');

    expect(cleanup).toEqual(expect.any(Function));
    cleanup?.();
    await flushMount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(settingEl).toBeEmptyDOMElement();
  });

  it('keeps display as the Obsidian 1.12 fallback', async () => {
    const dispose = jest.fn(async () => undefined);
    mockedMountSettings.mockResolvedValue({ dispose });
    const { host } = createHost();

    (host as unknown as { display(): void }).display();
    await flushMount();
    expect(mockedMountSettings).toHaveBeenCalledWith(expect.objectContaining({
      container: host.containerEl,
    }));

    host.hide();
    await flushMount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('refreshes the declarative index after a locale change', () => {
    const { cleanups, host } = createHost();
    const update = jest.fn();
    Object.defineProperty(host, 'update', { configurable: true, value: update });

    appI18n.setLocale('zh-CN');
    expect(update).toHaveBeenCalledTimes(1);
    expect(host.getSettingDefinitions()[0]).toMatchObject({
      aliases: expect.arrayContaining(['通用', '模型', '工具']),
    });

    cleanups.forEach((cleanup) => cleanup());
    appI18n.setLocale('en');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
