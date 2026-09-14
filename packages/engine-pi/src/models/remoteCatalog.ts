import type { Api, Model, Provider } from '@earendil-works/pi-ai';
import type { FetchCompatible } from '@pivi/agent/ports';

import { VERSION as PIVI_PI_VERSION } from '../shims/piCodingAgentConfig';

/**
 * Mirrors the pi-coding-agent remote model catalog: builtin providers fetch a
 * per-provider catalog from the shared Pi endpoint and overlay it over the
 * models bundled with the pinned pi-ai release, so provider model lists stay
 * current between Pi pin bumps. Implemented Pivi-owned instead of imported
 * because upstream reaches `node_modules` internals and uses free `fetch`,
 * while Pivi must keep scoped HTTP egress and its Pi-boundary rules intact.
 */

const DEFAULT_CATALOG_BASE_URL = 'https://pi.dev';
const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 4000;

/** Persisted remote-catalog overlay for one provider. */
export interface RemoteCatalogEntry {
  readonly models: readonly Model<Api>[];
  /** Unix timestamp of the last completed remote check. */
  readonly checkedAt: number;
  /** Unix timestamp from the remote catalog's Last-Modified header; 0 when absent. */
  readonly lastModified: number;
  /** Opaque ETag validator echoed back as If-None-Match. */
  readonly etag?: string;
  /**
   * Exact synchronized Pi pin the overlay was fetched for. Overlays carry
   * engine-shape assumptions (api dispatch, thinking maps), so a pin bump
   * discards them instead of layering a foreign catalog over new bundled data.
   */
  readonly piVersion: string;
}

/**
 * Device-local persistence for remote catalog overlays. Synchronous because
 * the overlay cache is small and the injected host local-storage API is sync.
 */
export interface RemoteCatalogStore {
  read(providerId: string): RemoteCatalogEntry | undefined;
  write(providerId: string, entry: RemoteCatalogEntry): void;
}

export interface RemoteCatalogDeps {
  /** Purpose-scoped provider fetch; absent deps make refresh report `skipped`. */
  readonly fetch?: FetchCompatible;
  readonly store?: RemoteCatalogStore;
  /** Catalog endpoint base URL (test override). */
  readonly baseUrl?: string;
  /** Freshness window between remote revalidations. */
  readonly refreshIntervalMs?: number;
  /** Per-attempt network deadline. */
  readonly attemptTimeoutMs?: number;
  readonly now?: () => number;
}

export type RemoteCatalogRefreshStatus = 'updated' | 'current' | 'unavailable' | 'skipped';

export interface RemoteCatalogRefreshResult {
  readonly status: RemoteCatalogRefreshStatus;
  /** Overlay models absent from the bundled baseline. */
  readonly addedModels: number;
  /** Overlay models that replaced a bundled baseline entry by id. */
  readonly updatedModels: number;
  readonly totalModels: number;
}

export interface RemoteCatalogProvider<T extends Provider = Provider> {
  /** Wrapped provider to register into the pi-ai Models collection. */
  readonly provider: T;
  readonly refresh: (options?: { force?: boolean; signal?: AbortSignal }) => Promise<RemoteCatalogRefreshResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Upstream merge semantics: replace bundled models by id and append new ones,
 * never remove. Bundled entries stay resolvable so restored sessions bound to
 * a model id the catalog later dropped (or renamed) keep working.
 */
function mergeModels(
  baseline: readonly Model<Api>[],
  dynamic: readonly Model<Api>[],
): Model<Api>[] {
  const merged = [...baseline];
  for (const model of dynamic) {
    const index = merged.findIndex((entry) => entry.id === model.id);
    if (index >= 0) merged[index] = model;
    else merged.push(model);
  }
  return merged;
}

function sanitizeCost(value: unknown): Model<Api>['cost'] | null {
  if (!isRecord(value)) return null;
  const input = value.input;
  const output = value.output;
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return null;
  if (typeof output !== 'number' || !Number.isFinite(output) || output < 0) return null;
  const cacheRead = typeof value.cacheRead === 'number' && Number.isFinite(value.cacheRead) ? value.cacheRead : 0;
  const cacheWrite = typeof value.cacheWrite === 'number' && Number.isFinite(value.cacheWrite) ? value.cacheWrite : 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(Array.isArray(value.tiers) ? { tiers: value.tiers } : {}),
  };
}

function sanitizeInput(value: unknown): Model<Api>['input'] {
  if (!Array.isArray(value)) return ['text'];
  const filtered = value.filter((entry): entry is 'text' | 'image' => entry === 'text' || entry === 'image');
  return filtered.length > 0 ? filtered : ['text'];
}

/**
 * Structural validation for one remote catalog entry. Entries are rejected
 * when required fields are missing or malformed, and — the compatibility
 * guard — when their `api` dispatch target is not used by any bundled
 * baseline model: the installed pi-ai build may not implement a newer api
 * type, and such a model would only fail at stream time. Baseline api values
 * are supported by construction, so overlay models stay streamable.
 */
function sanitizeRemoteModel(
  entry: unknown,
  providerId: string,
  supportedApis: ReadonlySet<string>,
  fallbackBaseUrl: string | undefined,
): Model<Api> | null {
  if (!isRecord(entry)) return null;
  const id = entry.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  const api = entry.api;
  if (typeof api !== 'string' || !api.trim()) return null;
  if (supportedApis.size > 0 && !supportedApis.has(api)) return null;
  const contextWindow = entry.contextWindow;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  const maxTokens = entry.maxTokens;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  const cost = sanitizeCost(entry.cost);
  if (!cost) return null;
  const baseUrl = typeof entry.baseUrl === 'string' && entry.baseUrl.trim()
    ? entry.baseUrl
    : fallbackBaseUrl;
  if (!baseUrl) return null;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : id;
  const thinkingLevelMap = isRecord(entry.thinkingLevelMap) ? entry.thinkingLevelMap : undefined;
  const compat = isRecord(entry.compat) ? entry.compat : undefined;
  const headerEntries = isRecord(entry.headers)
    ? Object.entries(entry.headers).filter((pair): pair is [string, string] => (
      typeof pair[1] === 'string' && pair[0].length > 0
    ))
    : undefined;
  const headers = headerEntries && headerEntries.length > 0
    ? Object.fromEntries(headerEntries)
    : undefined;
  const samplingParams = isRecord(entry.samplingParams) ? entry.samplingParams : undefined;
  // Built explicitly rather than spread: unknown payload fields must not leak
  // into the registry, and every `Model` field is covered below.
  return {
    id,
    name,
    api,
    provider: providerId,
    baseUrl,
    reasoning: entry.reasoning === true,
    input: sanitizeInput(entry.input),
    cost,
    contextWindow,
    maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {}),
    ...(headers ? { headers } : {}),
    ...(samplingParams ? { samplingParams } : {}),
  };
}

/**
 * Normalize a remote catalog payload. Accepts the shapes the Pi endpoint has
 * shipped — a bare array, a `{ models: [...] }` envelope, or an id-keyed
 * object map — and drops malformed entries instead of failing the refresh.
 */
function parseCatalogPayload(
  providerId: string,
  payload: unknown,
  supportedApis: ReadonlySet<string>,
  fallbackBaseUrl: string | undefined,
): { models: Model<Api>[]; dropped: number } {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.models)
      ? payload.models
      : isRecord(payload)
        ? Object.values(payload)
        : undefined;
  if (!entries) {
    throw new Error(`Invalid model catalog for provider "${providerId}"`);
  }
  const models: Model<Api>[] = [];
  let dropped = 0;
  for (const entry of entries) {
    const sanitized = sanitizeRemoteModel(entry, providerId, supportedApis, fallbackBaseUrl);
    if (sanitized) models.push(sanitized);
    else dropped += 1;
  }
  return { models, dropped };
}

/** Add a persisted device-local remote-catalog overlay to a builtin provider. */
export function withPiviRemoteCatalog<T extends Provider>(
  provider: T,
  deps: RemoteCatalogDeps = {},
): RemoteCatalogProvider<T> {
  const providerId = provider.id;
  const baseUrl = deps.baseUrl ?? DEFAULT_CATALOG_BASE_URL;
  const refreshIntervalMs = deps.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;

  const baselineIds = new Set(provider.getModels().map((model) => model.id));
  const supportedApis = new Set(
    provider.getModels()
      .map((model) => model.api)
      .filter((api): api is string => typeof api === 'string' && api.length > 0),
  );

  let dynamicModels: Model<Api>[] = [];
  const stored = deps.store?.read(providerId);
  if (stored && stored.piVersion === PIVI_PI_VERSION && stored.models.length > 0) {
    dynamicModels = [...stored.models];
  }

  const mergedTotal = (): number => mergeModels(provider.getModels(), dynamicModels).length;

  const emptyResult = (status: RemoteCatalogRefreshStatus): RemoteCatalogRefreshResult => ({
    status,
    addedModels: 0,
    updatedModels: 0,
    totalModels: mergedTotal(),
  });

  const refresh = async (
    options?: { force?: boolean; signal?: AbortSignal },
  ): Promise<RemoteCatalogRefreshResult> => {
    if (!deps.fetch) {
      return emptyResult('skipped');
    }
    const current = deps.store?.read(providerId);
    if (
      !options?.force
      && current
      && Number.isFinite(current.checkedAt)
      && now() - current.checkedAt < refreshIntervalMs
    ) {
      return emptyResult('current');
    }

    const url = new URL(`/api/models/providers/${encodeURIComponent(providerId)}`, baseUrl).toString();
    // Only revalidate when a cached body backs the validator, so a 304 can
    // never leave the overlay empty.
    const headers: Record<string, string> = { accept: 'application/json' };
    if (current?.etag && current.models.length > 0) {
      headers['if-none-match'] = current.etag;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), attemptTimeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    try {
      const response = await deps.fetch(url, { headers, signal });
      const checkedAt = now();
      if (response.status === 304 && current) {
        deps.store?.write(providerId, { ...current, checkedAt });
        return emptyResult('current');
      }
      if (response.status === 404 || response.status === 501) {
        // No remote catalog for this provider: clear any stale overlay and
        // mark the provider checked so the next window does not re-probe.
        dynamicModels = [];
        deps.store?.write(providerId, {
          models: [],
          checkedAt,
          lastModified: 0,
          piVersion: PIVI_PI_VERSION,
        });
        return emptyResult('unavailable');
      }
      if (!response.ok) {
        // Transient failure: the cached overlay and validator stay valid, so
        // keep the etag and only move the freshness window.
        if (current) deps.store?.write(providerId, { ...current, checkedAt });
        throw new Error(`Model catalog request failed for ${providerId}: ${response.status}`);
      }
      const payload: unknown = await response.json();
      const { models: parsed } = parseCatalogPayload(
        providerId,
        payload,
        supportedApis,
        provider.baseUrl,
      );
      const lastModifiedHeader = response.headers?.get?.('last-modified') ?? '';
      const lastModified = Date.parse(lastModifiedHeader);
      const etag = response.headers?.get?.('etag') ?? undefined;
      const entry: RemoteCatalogEntry = {
        models: parsed,
        checkedAt,
        lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
        ...(etag ? { etag } : {}),
        piVersion: PIVI_PI_VERSION,
      };
      dynamicModels = parsed;
      deps.store?.write(providerId, entry);
      const addedModels = parsed.filter((model) => !baselineIds.has(model.id)).length;
      return {
        status: 'updated',
        addedModels,
        updatedModels: parsed.length - addedModels,
        totalModels: mergedTotal(),
      };
    } finally {
      window.clearTimeout(timer);
    }
  };

  const wrappedProvider = {
    ...provider,
    getModels: () => mergeModels(provider.getModels(), dynamicModels),
  };

  return { provider: wrappedProvider, refresh };
}
