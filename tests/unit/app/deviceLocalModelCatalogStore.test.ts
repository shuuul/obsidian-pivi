import { App } from 'obsidian';

import {
  DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY,
  ObsidianDeviceLocalModelCatalogStore,
} from '@/app/deviceLocalModelCatalogStore';

const validModel = {
  id: 'gpt-4.1',
  name: 'GPT 4.1',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: false,
  input: ['text'] as const,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
};

const validEntry = {
  models: [validModel],
  checkedAt: 1,
  lastModified: 2,
  piVersion: '0.83.0',
};

describe('ObsidianDeviceLocalModelCatalogStore', () => {
  it('reads a structurally valid v1 overlay', () => {
    const app = new App();
    app.saveLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY, {
      version: 1,
      entries: { openai: validEntry },
    });
    const store = new ObsidianDeviceLocalModelCatalogStore(app);

    expect(store.read('openai')).toEqual(validEntry);
  });

  it('drops malformed model entries from a v1 overlay', () => {
    const app = new App();
    app.saveLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY, {
      version: 1,
      entries: {
        openai: {
          ...validEntry,
          models: [{ id: 'broken' }, validModel, { id: '' }],
        },
      },
    });
    const store = new ObsidianDeviceLocalModelCatalogStore(app);

    expect(store.read('openai')?.models).toEqual([validModel]);
  });

  it('resets to empty and warns when the stored schema version is not 1', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const app = new App();
    app.saveLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY, {
      version: 2,
      entries: { openai: validEntry },
    });
    const store = new ObsidianDeviceLocalModelCatalogStore(app);

    expect(store.read('openai')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/corrupt/i));
    warn.mockRestore();
  });
});
