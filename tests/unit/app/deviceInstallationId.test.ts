import { App } from 'obsidian';

import {
  DEVICE_INSTALLATION_ID_STORAGE_KEY,
  getOrCreateDeviceInstallationId,
} from '@/app/deviceInstallationId';

describe('getOrCreateDeviceInstallationId', () => {
  it('creates a UUID once and returns the same id afterwards', () => {
    const app = new App();

    const first = getOrCreateDeviceInstallationId(app);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(app.loadLocalStorage(DEVICE_INSTALLATION_ID_STORAGE_KEY)).toBe(first);
    expect(getOrCreateDeviceInstallationId(app)).toBe(first);
  });

  it('replaces a malformed stored value', () => {
    const app = new App();
    app.saveLocalStorage(DEVICE_INSTALLATION_ID_STORAGE_KEY, 'not-a-uuid');

    const id = getOrCreateDeviceInstallationId(app);

    expect(id).not.toBe('not-a-uuid');
    expect(app.loadLocalStorage(DEVICE_INSTALLATION_ID_STORAGE_KEY)).toBe(id);
  });
});
