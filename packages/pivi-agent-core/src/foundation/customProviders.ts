/** Wire API used by a custom / local provider instance. */
export type CustomProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages';

/** User-facing provider kind chosen when adding a provider. */
export type CustomProviderKind =
  | 'ollama'
  | 'lmstudio'
  | 'llama-cpp'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'openai-responses';

/** Model row stored for a custom provider after fetch or manual edit. */
export interface CustomProviderModelDef {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

/** Persisted custom / local provider configuration. */
export interface CustomProviderConfig {
  id: string;
  kind: CustomProviderKind;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  headers?: Record<string, string>;
  models: CustomProviderModelDef[];
  /** When true, readiness requires an API key (or env). Locals default false. */
  apiKeyRequired?: boolean;
}

export const LOCAL_CUSTOM_PROVIDER_KINDS = [
  'ollama',
  'lmstudio',
  'llama-cpp',
] as const satisfies readonly CustomProviderKind[];

export const MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS = [
  'openai-compatible',
  'anthropic-compatible',
  'openai-responses',
] as const satisfies readonly CustomProviderKind[];

export const ALL_CUSTOM_PROVIDER_KINDS = [
  ...LOCAL_CUSTOM_PROVIDER_KINDS,
  ...MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS,
] as const satisfies readonly CustomProviderKind[];

export const FIXED_LOCAL_PROVIDER_IDS: Record<
  (typeof LOCAL_CUSTOM_PROVIDER_KINDS)[number],
  string
> = {
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  'llama-cpp': 'llama-cpp',
};

const DEFAULT_BASE_URLS: Record<CustomProviderKind, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  'llama-cpp': 'http://localhost:8080/v1',
  'openai-compatible': '',
  'anthropic-compatible': '',
  'openai-responses': '',
};

const KIND_TO_API: Record<CustomProviderKind, CustomProviderApi> = {
  ollama: 'openai-completions',
  lmstudio: 'openai-completions',
  'llama-cpp': 'openai-completions',
  'openai-compatible': 'openai-completions',
  'anthropic-compatible': 'anthropic-messages',
  'openai-responses': 'openai-responses',
};

const KIND_DISPLAY_NAMES: Record<CustomProviderKind, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'llama-cpp': 'llama.cpp',
  'openai-compatible': 'OpenAI compatible',
  'anthropic-compatible': 'Anthropic compatible',
  'openai-responses': 'OpenAI Responses',
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isCustomProviderKind(value: unknown): value is CustomProviderKind {
  return typeof value === 'string'
    && (ALL_CUSTOM_PROVIDER_KINDS as readonly string[]).includes(value);
}

export function isLocalCustomProviderKind(kind: CustomProviderKind): boolean {
  return (LOCAL_CUSTOM_PROVIDER_KINDS as readonly string[]).includes(kind);
}

export function getCustomProviderKindDisplayName(kind: CustomProviderKind): string {
  return KIND_DISPLAY_NAMES[kind];
}

export function getDefaultBaseUrlForKind(kind: CustomProviderKind): string {
  return DEFAULT_BASE_URLS[kind];
}

export function getApiForCustomProviderKind(kind: CustomProviderKind): CustomProviderApi {
  return KIND_TO_API[kind];
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function modelsListUrl(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl);
  if (normalized.endsWith('/models')) {
    return normalized;
  }
  return `${normalized}/models`;
}

export function createCustomProviderId(kind: CustomProviderKind, existingIds: readonly string[]): string {
  if (isLocalCustomProviderKind(kind)) {
    return FIXED_LOCAL_PROVIDER_IDS[kind as (typeof LOCAL_CUSTOM_PROVIDER_KINDS)[number]];
  }

  const used = new Set(existingIds);
  const base = `custom-${kind}`;
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

export function createDefaultCustomProviderConfig(
  kind: CustomProviderKind,
  existingIds: readonly string[],
  options?: { name?: string; baseUrl?: string },
): CustomProviderConfig {
  const id = createCustomProviderId(kind, existingIds);
  return {
    id,
    kind,
    name: options?.name?.trim() || KIND_DISPLAY_NAMES[kind],
    baseUrl: normalizeProviderBaseUrl(options?.baseUrl ?? DEFAULT_BASE_URLS[kind]),
    api: KIND_TO_API[kind],
    models: [],
    apiKeyRequired: !isLocalCustomProviderKind(kind),
  };
}

export function normalizeCustomProviderModelDef(raw: unknown): CustomProviderModelDef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim()) {
    return null;
  }
  const id = raw.id.trim();
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const contextWindow = typeof raw.contextWindow === 'number' && raw.contextWindow > 0
    ? Math.floor(raw.contextWindow)
    : undefined;
  const maxTokens = typeof raw.maxTokens === 'number' && raw.maxTokens > 0
    ? Math.floor(raw.maxTokens)
    : undefined;
  const reasoning = typeof raw.reasoning === 'boolean' ? raw.reasoning : undefined;
  return {
    id,
    name,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

export function normalizeCustomProviderConfig(raw: unknown): CustomProviderConfig | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return null;
  }
  if (!isCustomProviderKind(raw.kind)) {
    return null;
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    return null;
  }
  if (typeof raw.baseUrl !== 'string') {
    return null;
  }

  const api = typeof raw.api === 'string' && isCustomProviderApi(raw.api)
    ? raw.api
    : KIND_TO_API[raw.kind];

  const models = Array.isArray(raw.models)
    ? raw.models
      .map(normalizeCustomProviderModelDef)
      .filter((model): model is CustomProviderModelDef => model !== null)
    : [];

  let headers: Record<string, string> | undefined;
  if (isRecord(raw.headers)) {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.headers)) {
      if (typeof value === 'string' && key.trim()) {
        next[key] = value;
      }
    }
    if (Object.keys(next).length > 0) {
      headers = next;
    }
  }

  return {
    id: raw.id.trim(),
    kind: raw.kind,
    name: raw.name.trim(),
    baseUrl: normalizeProviderBaseUrl(raw.baseUrl),
    api,
    models,
    ...(headers ? { headers } : {}),
    apiKeyRequired: typeof raw.apiKeyRequired === 'boolean'
      ? raw.apiKeyRequired
      : !isLocalCustomProviderKind(raw.kind),
  };
}

function isCustomProviderApi(value: string): value is CustomProviderApi {
  return value === 'openai-completions'
    || value === 'openai-responses'
    || value === 'anthropic-messages';
}

export function normalizeCustomProviders(raw: unknown): CustomProviderConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: CustomProviderConfig[] = [];
  for (const item of raw) {
    const config = normalizeCustomProviderConfig(item);
    if (!config || seen.has(config.id)) {
      continue;
    }
    seen.add(config.id);
    result.push(config);
  }
  return result;
}

export function getCustomProvidersFromBag(
  settings: Record<string, unknown>,
): CustomProviderConfig[] {
  const agentSettings = settings.agentSettings;
  if (!isRecord(agentSettings)) {
    return [];
  }
  return normalizeCustomProviders(agentSettings.customProviders);
}

export function getCustomProviderById(
  settings: Record<string, unknown>,
  providerId: string,
): CustomProviderConfig | null {
  return getCustomProvidersFromBag(settings).find((provider) => provider.id === providerId) ?? null;
}

export function isCustomProviderId(
  settings: Record<string, unknown>,
  providerId: string,
): boolean {
  return getCustomProviderById(settings, providerId) !== null;
}

export function defaultModelMeta(model: CustomProviderModelDef): {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
} {
  return {
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
    reasoning: model.reasoning ?? false,
  };
}

/** Parse OpenAI-style `{ data: [{ id, ... }] }` or bare array payloads into model defs. */
export function parseOpenAiStyleModelsList(payload: unknown): CustomProviderModelDef[] {
  const rows = extractModelRows(payload);
  const models: CustomProviderModelDef[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const id = typeof row.id === 'string'
      ? row.id.trim()
      : typeof row.name === 'string'
        ? row.name.trim()
        : '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
    const contextWindow = readPositiveNumber(
      row.context_window
      ?? row.contextWindow
      ?? row.max_model_len
      ?? row.loaded_context_length
      ?? row.max_context_length,
    );
    const maxTokens = readPositiveNumber(
      row.max_tokens
      ?? row.maxTokens
      ?? row.max_output_tokens,
    );
    models.push({
      id,
      name,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

function extractModelRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.models)) {
    return payload.models;
  }
  return [];
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}
