import { App } from 'obsidian';

import {
  DEVICE_LOCAL_PROVIDER_STORAGE_KEY,
  ObsidianDeviceLocalProviderStore,
} from '@/app/deviceLocalProviderStore';
import {
  DeviceLocalProviderStateVersionError,
  seedDefaultDeviceLocalProviderState,
} from '@pivi/pivi-agent-core/foundation/deviceLocalProviderState';

describe('ObsidianDeviceLocalProviderStore', () => {
  it('reports absent storage as uninitialized', () => {
    const app = new App();
    const store = new ObsidianDeviceLocalProviderStore(app);

    expect(store.isInitialized()).toBe(false);
    expect(store.loadInitialized()).toBeNull();
  });

  it('saves initialized state with defensive normalization and copy semantics on read', () => {
    const app = new App();
    const store = new ObsidianDeviceLocalProviderStore(app);
    const seeded = seedDefaultDeviceLocalProviderState();

    store.save(seeded);
    const loaded = store.loadInitialized();

    expect(store.isInitialized()).toBe(true);
    expect(loaded).toEqual(seeded);
    expect(loaded).not.toBe(seeded);
    expect(loaded?.providers).not.toBe(seeded.providers);
    expect(app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY)).toEqual({
      version: 1,
      initialized: true,
      providers: [{ id: 'deepseek', type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: ['deepseek/deepseek-chat'],
        activeModel: 'deepseek/deepseek-chat',
        titleGenerationModel: '',
        customContextLimits: {},
      },
      webSearchTools: {
        providerOrder: ['brave', 'tavily', 'exa', 'anysearch'],
        disabledProviders: [],
      },
    });
  });

  it('treats uninitialized payloads as absent without overwriting storage', () => {
    const app = new App();
    app.saveLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY, {
      version: 1,
      initialized: false,
      providers: [],
    });
    const store = new ObsidianDeviceLocalProviderStore(app);

    expect(store.isInitialized()).toBe(false);
    expect(store.loadInitialized()).toBeNull();
    expect(app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY)).toEqual({
      version: 1,
      initialized: false,
      providers: [],
    });
  });

  it('fails closed on unsupported schema versions', () => {
    const app = new App();
    app.saveLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY, {
      version: 2,
      initialized: true,
      providers: [],
    });
    const store = new ObsidianDeviceLocalProviderStore(app);

    expect(() => store.loadInitialized()).toThrow(DeviceLocalProviderStateVersionError);
    expect(() => store.isInitialized()).toThrow(DeviceLocalProviderStateVersionError);
    expect(app.loadLocalStorage(DEVICE_LOCAL_PROVIDER_STORAGE_KEY)).toEqual({
      version: 2,
      initialized: true,
      providers: [],
    });
  });
});
