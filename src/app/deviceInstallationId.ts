import type { App } from 'obsidian';

export const DEVICE_INSTALLATION_ID_STORAGE_KEY = 'pivi.device-id.v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stable per-device installation id. Sign in with ChatGPT registers it as the
 * OpenAI agent host, so it must survive reloads but never sync between devices
 * through `.pivi/settings.json`.
 */
export function getOrCreateDeviceInstallationId(app: App): string {
  const stored: unknown = app.loadLocalStorage(DEVICE_INSTALLATION_ID_STORAGE_KEY);
  if (typeof stored === 'string' && UUID_PATTERN.test(stored)) {
    return stored;
  }
  const id = crypto.randomUUID();
  app.saveLocalStorage(DEVICE_INSTALLATION_ID_STORAGE_KEY, id);
  return id;
}
