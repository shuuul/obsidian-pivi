import { App } from 'obsidian';

import {
  DEVICE_LOCAL_EXTERNAL_CONTEXT_STORAGE_KEY,
  ObsidianDeviceLocalExternalContextStore,
} from '@/app/deviceLocalExternalContextStore';

describe('ObsidianDeviceLocalExternalContextStore', () => {
  it('stores external roots and per-session turn overlays in vault-local storage', () => {
    const app = new App();
    const store = new ObsidianDeviceLocalExternalContextStore(app);

    store.setExternalReadDirectories([' /outside/root ', '/outside/root']);
    store.setSessionPaths('.pivi/sessions/a.jsonl', ['/outside/root']);
    store.setTurnPaths('.pivi/sessions/a.jsonl', 'user-1', ['/outside/file']);

    expect(store.getExternalReadDirectories()).toEqual(['/outside/root']);
    expect(store.getSessionPaths('.pivi/sessions/a.jsonl')).toEqual(['/outside/root']);
    expect(store.getTurnPaths('.pivi/sessions/a.jsonl', 'user-1')).toEqual(['/outside/file']);
    expect(app.loadLocalStorage(DEVICE_LOCAL_EXTERNAL_CONTEXT_STORAGE_KEY)).toEqual({
      version: 1,
      externalReadDirectories: ['/outside/root'],
      sessions: {
        '.pivi/sessions/a.jsonl': {
          selectedPaths: ['/outside/root'],
          turns: { 'user-1': ['/outside/file'] },
        },
      },
    });
  });

  it('copies fork overlays without sharing mutable arrays', () => {
    const app = new App();
    const store = new ObsidianDeviceLocalExternalContextStore(app);
    store.setTurnPaths('source.jsonl', 'user-1', ['/source']);

    store.copySession('source.jsonl', 'fork.jsonl');
    store.setTurnPaths('source.jsonl', 'user-1', ['/changed']);

    expect(store.getTurnPaths('fork.jsonl', 'user-1')).toEqual(['/source']);
  });
});
