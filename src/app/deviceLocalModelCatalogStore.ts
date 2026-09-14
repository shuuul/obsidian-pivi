import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { RemoteCatalogEntry, RemoteCatalogStore } from '@pivi/engine-pi/application/models';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY = 'pivi.model-catalog.v1';
const DEVICE_LOCAL_MODEL_CATALOG_VERSION = 1;

const logger = new PluginLogger('ModelCatalogStore');

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidCachedModel(value: unknown): value is RemoteCatalogEntry['models'][number] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.api !== 'string' || !value.api.trim()) return false;
  if (typeof value.provider !== 'string' || !value.provider.trim()) return false;
  if (typeof value.baseUrl !== 'string' || !value.baseUrl.trim()) return false;
  if (!isFiniteNumber(value.contextWindow) || value.contextWindow <= 0) return false;
  if (!isFiniteNumber(value.maxTokens) || value.maxTokens <= 0) return false;
  if (!isRecord(value.cost)) return false;
  if (!isFiniteNumber(value.cost.input) || value.cost.input < 0) return false;
  if (!isFiniteNumber(value.cost.output) || value.cost.output < 0) return false;
  return true;
}

function sanitizeStoredEntry(value: unknown): RemoteCatalogEntry | undefined {
  if (!isRecord(value) || !Array.isArray(value.models)) return undefined;
  if (typeof value.piVersion !== 'string' || !value.piVersion) return undefined;
  const models = value.models.filter(isValidCachedModel);
  // The engine persists `models: []` as an availability marker for providers
  // with no remote catalog, so an empty array must survive sanitization or
  // every boot re-probes those providers. A non-empty array whose rows all
  // fail validation is corruption instead and resets per the store contract.
  if (value.models.length > 0 && models.length === 0) return undefined;
  const checkedAt = isFiniteNumber(value.checkedAt) ? value.checkedAt : 0;
  const lastModified = isFiniteNumber(value.lastModified) ? value.lastModified : 0;
  return {
    models,
    checkedAt,
    lastModified,
    ...(typeof value.etag === 'string' ? { etag: value.etag } : {}),
    piVersion: value.piVersion,
  };
}

function readStoredEntries(app: App): Record<string, unknown> {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_MODEL_CATALOG_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  if (!isRecord(raw) || raw.version !== DEVICE_LOCAL_MODEL_CATALOG_VERSION || !isRecord(raw.entries)) {
    logger.warn('Model catalog storage was corrupt; resetting to empty.');
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
      version: DEVICE_LOCAL_MODEL_CATALOG_VERSION,
      entries: next,
    });
  }
}
