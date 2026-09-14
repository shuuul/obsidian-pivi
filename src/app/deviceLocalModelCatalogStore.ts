import type { RemoteCatalogEntry, RemoteCatalogStore } from '@pivi/engine-pi/application/models';
import type { App } from 'obsidian';

const DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY = 'pivi.model-catalog.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStoredEntry(value: unknown): RemoteCatalogEntry | undefined {
  if (!isRecord(value) || !Array.isArray(value.models)) return undefined;
  if (typeof value.piVersion !== 'string' || !value.piVersion) return undefined;
  const checkedAt = typeof value.checkedAt === 'number' && Number.isFinite(value.checkedAt)
    ? value.checkedAt
    : 0;
  const lastModified = typeof value.lastModified === 'number' && Number.isFinite(value.lastModified)
    ? value.lastModified
    : 0;
  // Model entries were validated by the engine before persisting; the cache
  // keeps the stored body verbatim so the engine applies its own version guard.
  return {
    models: value.models as RemoteCatalogEntry['models'],
    checkedAt,
    lastModified,
    ...(typeof value.etag === 'string' ? { etag: value.etag } : {}),
    piVersion: value.piVersion,
  };
}

function readStoredEntries(app: App): Record<string, unknown> {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY);
  if (!isRecord(raw) || !isRecord(raw.entries)) {
    return {};
  }
  return raw.entries;
}

/**
 * Device-local cache for builtin remote model catalog overlays, keyed by
 * provider id under `pivi.model-catalog.v1`. Overlays are device-local and
 * deliberately never enter synced `.pivi/settings.json`.
 */
export class ObsidianDeviceLocalModelCatalogStore implements RemoteCatalogStore {
  constructor(private readonly app: App) {}

  read(providerId: string): RemoteCatalogEntry | undefined {
    return sanitizeStoredEntry(readStoredEntries(this.app)[providerId]);
  }

  write(providerId: string, entry: RemoteCatalogEntry): void {
    const entries = readStoredEntries(this.app);
    const next = { ...entries, [providerId]: entry };
    this.app.saveLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY, {
      version: 1,
      entries: next,
    });
  }
}
