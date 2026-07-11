import {
  type Api,
  createProvider,
  envApiKeyAuth,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderAuth,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import {
  type CustomProviderApi,
  type CustomProviderConfig,
  type CustomProviderModelDef,
  defaultModelMeta,
  isLocalCustomProviderKind,
  modelsListUrl,
  normalizeProviderBaseUrl,
  parseOpenAiStyleModelsList,
} from '../../foundation/customProviders';

export interface CustomProviderFetchResult {
  models: CustomProviderModelDef[];
}

export type CustomProviderHttpGet = (
  url: string,
  options?: {
    headers?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
  },
) => Promise<{ status: number; body: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return undefined;
}

function zeroCost() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function openAiCompatFlags(kind: CustomProviderConfig['kind']): Model<'openai-completions'>['compat'] {
  if (isLocalCustomProviderKind(kind) || kind === 'openai-compatible') {
    return {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    };
  }
  return undefined;
}

export function buildCustomProviderModels(
  config: CustomProviderConfig,
): Model<Api>[] {
  const baseUrl = normalizeProviderBaseUrl(config.baseUrl);
  const headers = config.headers;

  return config.models.map((modelDef) => {
    const meta = defaultModelMeta(modelDef, config.kind);
    const base = {
      id: modelDef.id,
      name: modelDef.name,
      provider: config.id,
      baseUrl,
      reasoning: meta.reasoning,
      contextWindowIsAuthoritative: modelDef.contextWindow !== undefined,
      input: ['text'] as ('text' | 'image')[],
      cost: zeroCost(),
      contextWindow: meta.contextWindow,
      maxTokens: meta.maxTokens,
      ...(headers ? { headers } : {}),
    };

    if (config.api === 'anthropic-messages') {
      return {
        ...base,
        api: 'anthropic-messages' as const,
      } satisfies Model<'anthropic-messages'>;
    }

    if (config.api === 'openai-responses') {
      return {
        ...base,
        api: 'openai-responses' as const,
      } satisfies Model<'openai-responses'>;
    }

    return {
      ...base,
      api: 'openai-completions' as const,
      compat: openAiCompatFlags(config.kind),
    } satisfies Model<'openai-completions'>;
  });
}

function resolveApiStreams(api: CustomProviderApi) {
  switch (api) {
    case 'anthropic-messages':
      return anthropicMessagesApi();
    case 'openai-responses':
      return openAIResponsesApi();
    case 'openai-completions':
    default:
      return openAICompletionsApi();
  }
}

// OpenAI-compatible clients require a non-empty apiKey string even for local
// servers that ignore Authorization (Ollama / LM Studio / llama.cpp). Use a
// stable placeholder so keyless resolve still produces a usable stream client.
const KEYLESS_API_KEY_PLACEHOLDER = 'unused';

function keylessAuthResolution() {
  return {
    auth: { apiKey: KEYLESS_API_KEY_PLACEHOLDER },
    source: 'keyless',
  };
}

function buildKeylessAuth(name: string): ProviderAuth {
  return {
    apiKey: {
      name,
      resolve: async () => keylessAuthResolution(),
    },
  };
}

function buildCustomProviderAuth(config: CustomProviderConfig): ProviderAuth {
  const envNames = getProviderEnvVarNames(config.id);
  if (config.apiKeyRequired === false || isLocalCustomProviderKind(config.kind)) {
    const envAuth = envApiKeyAuth(config.name, [envNames.apiKeyVar]);
    return {
      apiKey: {
        name: config.name,
        resolve: async (input) => {
          const resolved = await envAuth.resolve(input);
          return resolved ?? keylessAuthResolution();
        },
      },
    };
  }

  return {
    apiKey: envApiKeyAuth(config.name, [envNames.apiKeyVar]),
  };
}

function nativeProviderRoot(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname
    .replace(/\/models\/?$/, '')
    .replace(/\/v1\/?$/, '') || '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseJsonResponse(response: { status: number; body: string }, label: string): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} failed (${response.status}): ${response.body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(`${label} response was not valid JSON.`);
  }
}

function parseOllamaContextWindow(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const parameters = typeof payload.parameters === 'string' ? payload.parameters : '';
  const configured = parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m)?.[1];
  if (configured) {
    return readPositiveNumber(Number(configured));
  }
  if (!isRecord(payload.model_info)) {
    return undefined;
  }
  const architecture = payload.model_info['general.architecture'];
  return typeof architecture === 'string'
    ? readPositiveNumber(payload.model_info[`${architecture}.context_length`])
    : undefined;
}

async function fetchOllamaModels(
  baseUrl: string,
  headers: Record<string, string>,
  request: CustomProviderHttpGet,
): Promise<CustomProviderModelDef[]> {
  const root = nativeProviderRoot(baseUrl);
  const tags = parseJsonResponse(
    await request(`${root}/api/tags`, { headers }),
    'Ollama model list',
  );
  const models = parseOpenAiStyleModelsList(tags);
  return Promise.all(models.map(async (model) => {
    try {
      const detail = parseJsonResponse(await request(`${root}/api/show`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ model: model.id }),
      }), `Ollama model details for ${model.id}`);
      const contextWindow = parseOllamaContextWindow(detail);
      return contextWindow ? { ...model, contextWindow } : model;
    } catch {
      return model;
    }
  }));
}

function parseLmStudioV1Models(payload: unknown): CustomProviderModelDef[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return [];
  }
  return payload.models.flatMap((row): CustomProviderModelDef[] => {
    if (!isRecord(row) || row.type === 'embedding' || typeof row.key !== 'string' || !row.key.trim()) {
      return [];
    }
    const loadedContexts = Array.isArray(row.loaded_instances)
      ? row.loaded_instances
        .flatMap((instance) => {
          const value = isRecord(instance) && isRecord(instance.config)
            ? readPositiveNumber(instance.config.context_length)
            : undefined;
          return value === undefined ? [] : [value];
        })
      : [];
    const loadedContext = loadedContexts.length > 0
      ? Math.min(...loadedContexts)
      : undefined;
    const contextWindow = loadedContext ?? readPositiveNumber(row.max_context_length);
    const id = row.key.trim();
    const name = typeof row.display_name === 'string' && row.display_name.trim()
      ? row.display_name.trim()
      : id;
    return [{ id, name, ...(contextWindow ? { contextWindow } : {}) }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchLmStudioModels(
  baseUrl: string,
  headers: Record<string, string>,
  request: CustomProviderHttpGet,
): Promise<CustomProviderModelDef[]> {
  const root = nativeProviderRoot(baseUrl);
  const v1Response = await request(`${root}/api/v1/models`, { headers });
  if (v1Response.status >= 200 && v1Response.status < 300) {
    const models = parseLmStudioV1Models(parseJsonResponse(v1Response, 'LM Studio model list'));
    if (models.length > 0) {
      return models;
    }
  }
  const v0Response = await request(`${root}/api/v0/models`, { headers });
  if (v0Response.status >= 200 && v0Response.status < 300) {
    const models = parseOpenAiStyleModelsList(
      parseJsonResponse(v0Response, 'LM Studio model list'),
    );
    if (models.length > 0) {
      return models;
    }
  }
  return parseOpenAiStyleModelsList(parseJsonResponse(
    await request(modelsListUrl(baseUrl), { headers }),
    'LM Studio OpenAI-compatible model list',
  ));
}

function withLlamaCppMetadata(models: CustomProviderModelDef[], payload: unknown): CustomProviderModelDef[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return models;
  }
  const contexts = new Map<string, number>();
  for (const row of payload.data) {
    if (!isRecord(row) || typeof row.id !== 'string' || !isRecord(row.meta)) {
      continue;
    }
    const contextWindow = readPositiveNumber(row.meta.n_ctx)
      ?? readPositiveNumber(row.meta.n_ctx_train);
    if (contextWindow) {
      contexts.set(row.id, contextWindow);
    }
  }
  return models.map((model) => {
    const contextWindow = contexts.get(model.id);
    return contextWindow ? { ...model, contextWindow } : model;
  });
}

async function fetchLlamaCppModels(
  baseUrl: string,
  headers: Record<string, string>,
  request: CustomProviderHttpGet,
): Promise<CustomProviderModelDef[]> {
  const response = await request(modelsListUrl(baseUrl), { headers });
  const payload = parseJsonResponse(response, 'llama.cpp model list');
  let models = withLlamaCppMetadata(parseOpenAiStyleModelsList(payload), payload);
  if (models.length === 1) {
    try {
      const propsResponse = await request(`${nativeProviderRoot(baseUrl)}/props`, { headers });
      if (propsResponse.status >= 200 && propsResponse.status < 300) {
        const props = parseJsonResponse(propsResponse, 'llama.cpp properties');
        const contextWindow = isRecord(props) && isRecord(props.default_generation_settings)
          ? readPositiveNumber(props.default_generation_settings.n_ctx)
          : undefined;
        if (contextWindow) {
          const model = models[0];
          if (model) {
            models = [{ ...model, contextWindow }];
          }
        }
      }
    } catch {
      // Runtime properties are optional; model metadata remains usable.
    }
  }
  return models;
}

export async function fetchCustomProviderModels(
  config: CustomProviderConfig,
  httpGet: CustomProviderHttpGet,
  options?: { apiKey?: string },
): Promise<CustomProviderFetchResult> {
  const baseUrl = normalizeProviderBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error('Base URL is required.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(config.headers ?? {}),
  };
  if (options?.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
    if (config.api === 'anthropic-messages') {
      headers['x-api-key'] = options.apiKey.trim();
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
    }
  }

  let models: CustomProviderModelDef[];
  if (config.kind === 'ollama') {
    models = await fetchOllamaModels(baseUrl, headers, httpGet);
  } else if (config.kind === 'lmstudio') {
    models = await fetchLmStudioModels(baseUrl, headers, httpGet);
  } else if (config.kind === 'llama-cpp') {
    models = await fetchLlamaCppModels(baseUrl, headers, httpGet);
  } else {
    const response = await httpGet(modelsListUrl(baseUrl), { headers });
    models = parseOpenAiStyleModelsList(parseJsonResponse(response, 'Model list'));
  }

  if (models.length === 0) {
    throw new Error('Model list returned no models.');
  }
  return { models };
}

export function buildCustomPiProvider(
  config: CustomProviderConfig,
  options?: {
    httpGet?: CustomProviderHttpGet;
    getApiKey?: () => string | undefined;
  },
): Provider {
  const baseUrl = normalizeProviderBaseUrl(config.baseUrl);
  const models = buildCustomProviderModels(config);
  const api = resolveApiStreams(config.api);
  const httpGet = options?.httpGet;

  return createProvider({
    id: config.id,
    name: config.name,
    baseUrl: baseUrl || undefined,
    headers: config.headers,
    auth: baseUrl ? buildCustomProviderAuth(config) : buildKeylessAuth(config.name),
    models,
    refreshModels: httpGet
      ? async () => {
          const apiKey = options?.getApiKey?.();
          const fetched = await fetchCustomProviderModels(config, httpGet, { apiKey });
          // Mutate config so callers that hold the same object see the list.
          config.models = fetched.models;
          return buildCustomProviderModels({ ...config, models: fetched.models });
        }
      : undefined,
    api,
  });
}

export function installCustomProviders(
  models: MutableModels,
  configs: readonly CustomProviderConfig[],
  options?: {
    httpGet?: CustomProviderHttpGet;
    getApiKey?: (providerId: string) => string | undefined;
    previousCustomIds?: readonly string[];
  },
): void {
  const nextIds = new Set(configs.map((config) => config.id));
  for (const previousId of options?.previousCustomIds ?? []) {
    if (!nextIds.has(previousId)) {
      models.deleteProvider(previousId);
    }
  }

  for (const config of configs) {
    models.setProvider(
      buildCustomPiProvider(config, {
        httpGet: options?.httpGet,
        getApiKey: options?.getApiKey
          ? () => options.getApiKey?.(config.id)
          : undefined,
      }),
    );
  }
}
