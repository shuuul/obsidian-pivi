import {
  type Api,
  createProvider,
  envApiKeyAuth,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderAuth,
  type ThinkingLevelMap,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { getProviderEnvVarNames } from '@pivi/agent/auth/providerEnvVars';
import {
  type CustomProviderApi,
  type CustomProviderConfig,
  type CustomProviderModelDef,
  type CustomProviderReasoningEffort,
  defaultModelMeta,
  isLocalCustomProviderKind,
  mergeFetchedCustomProviderModelUserFields,
  modelsListUrl,
  normalizeProviderBaseUrl,
  parseCustomProviderReasoningMeta,
  parseOpenAiStyleModelsList,
} from '@pivi/agent/settings/customProviders';

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

const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

function thinkingLevelMapFromEfforts(
  efforts: readonly CustomProviderReasoningEffort[],
  options?: { mandatory?: boolean },
): ThinkingLevelMap {
  const supported = new Set(efforts);
  const map: ThinkingLevelMap = {};
  for (const level of PI_THINKING_LEVELS) {
    if (level === 'off') {
      map.off = options?.mandatory ? null : 'none';
      continue;
    }
    map[level] = supported.has(level) ? level : null;
  }
  return map;
}

/** Built-in catalog row used to inherit thinking levels onto a matching custom model id. */
export interface KnownModelReasoningSource {
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  defaultThinkingLevel?: (typeof PI_THINKING_LEVELS)[number];
}

export interface BuildCustomProviderModelsOptions {
  /** Built-in models whose ids may supply thinking levels when the card omits them. */
  knownModels?: readonly KnownModelReasoningSource[];
}

function modelIdAliases(modelId: string): string[] {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return [];
  }
  const slash = trimmed.lastIndexOf('/');
  const bare = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return bare === trimmed ? [trimmed] : [trimmed, bare];
}

function modelFamilyStem(modelId: string): string | undefined {
  const aliases = modelIdAliases(modelId);
  const bare = aliases.length > 0 ? aliases[aliases.length - 1]! : modelId.trim();
  const match = bare.match(/^[a-z]+[0-9]*/i);
  if (!match) {
    return undefined;
  }
  const stem = match[0].toLowerCase();
  return stem.length >= 5 ? stem : undefined;
}

function pickKnownModelReasoningSource(
  pool: readonly KnownModelReasoningSource[],
): KnownModelReasoningSource | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  const withMap = pool.filter((model) => model.thinkingLevelMap);
  const preferred = withMap.length > 0 ? withMap : pool;
  return preferred.find((model) => model.reasoning) ?? preferred[0];
}

function findKnownModelReasoningSource(
  modelId: string,
  knownModels: readonly KnownModelReasoningSource[],
): KnownModelReasoningSource | undefined {
  const aliases = new Set(modelIdAliases(modelId));
  if (aliases.size === 0) {
    return undefined;
  }

  const candidates = knownModels.filter((model) => (
    modelIdAliases(model.id).some((id) => aliases.has(id))
  ));
  if (candidates.length > 0) {
    const exact = candidates.filter((model) => model.id === modelId);
    return pickKnownModelReasoningSource(exact.length > 0 ? exact : candidates);
  }

  const stem = modelFamilyStem(modelId);
  if (!stem) {
    return undefined;
  }
  const family = knownModels.filter((model) => modelFamilyStem(model.id) === stem);
  return pickKnownModelReasoningSource(family);
}

function collectKnownModelReasoningSources(
  registry: MutableModels,
  excludeProviderIds: ReadonlySet<string>,
): KnownModelReasoningSource[] {
  return registry.getModels().flatMap((model) => {
    if (excludeProviderIds.has(model.provider)) {
      return [];
    }
    return [{
      id: model.id,
      reasoning: model.reasoning,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
      ...((model as KnownModelReasoningSource).defaultThinkingLevel
        ? { defaultThinkingLevel: (model as KnownModelReasoningSource).defaultThinkingLevel }
        : {}),
    }];
  });
}

function looksLikeQwenModel(modelDef: CustomProviderModelDef): boolean {
  return [modelDef.id, modelDef.catalogModelId, modelDef.name].some(
    (value) => typeof value === 'string' && /qwen/i.test(value),
  );
}

/** Qwen3.8 official levels: xhigh / medium / low. Off is enable_thinking=false. */
const QWEN38_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  off: 'none',
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: null,
  xhigh: 'xhigh',
  max: null,
};

function looksLikeQwen38Model(modelDef: CustomProviderModelDef): boolean {
  return [modelDef.id, modelDef.catalogModelId, modelDef.name].some(
    (value) => typeof value === 'string' && /qwen3(?:[._-]?8|8)/i.test(value),
  );
}

/** Qwen-on-SGLang/vLLM: the template reads enable_thinking + reasoning_effort from chat_template_kwargs. Top-level reasoning_effort is the OpenAI field and is ignored by this SGLang autodetection. */
const QWEN_CHAT_TEMPLATE_KWARGS = {
  enable_thinking: { $var: 'thinking.enabled' as const },
  reasoning_effort: { $var: 'thinking.effort' as const, omitWhenOff: true },
  preserve_thinking: true,
};

function openAiCompatFlags(
  kind: CustomProviderConfig['kind'],
  supportsReasoningEffort: boolean,
  options?: { qwenChatTemplate?: boolean },
): Model<'openai-completions'>['compat'] {
  if (isLocalCustomProviderKind(kind) || kind === 'openai-compatible') {
    return {
      supportsDeveloperRole: false,
      supportsReasoningEffort,
      ...(kind === 'openai-compatible'
        && supportsReasoningEffort
        && options?.qwenChatTemplate
        ? {
          thinkingFormat: 'chat-template' as const,
          chatTemplateKwargs: QWEN_CHAT_TEMPLATE_KWARGS,
        }
        : {}),
    };
  }
  return undefined;
}

export function buildCustomProviderModels(
  config: CustomProviderConfig,
  options?: BuildCustomProviderModelsOptions,
): Model<Api>[] {
  const baseUrl = customProviderRuntimeBaseUrl(config);
  const headers = config.headers;
  const knownModels = options?.knownModels ?? [];

  return config.models.map((modelDef) => {
    const meta = defaultModelMeta(modelDef, config.kind);
    const inherited = meta.reasoningMeta
      ? undefined
      : findKnownModelReasoningSource(modelDef.catalogModelId ?? modelDef.id, knownModels)
        ?? (modelDef.catalogModelId
          ? findKnownModelReasoningSource(modelDef.id, knownModels)
          : undefined);
    const qwen38Preset = looksLikeQwen38Model(modelDef);
    const thinkingLevelMap = meta.reasoningMeta
      ? thinkingLevelMapFromEfforts(meta.reasoningMeta.supportedEfforts, {
        mandatory: meta.reasoningMeta.mandatory,
      })
      : qwen38Preset
        ? { ...QWEN38_THINKING_LEVEL_MAP }
        : inherited?.thinkingLevelMap
          ? { ...inherited.thinkingLevelMap }
          : undefined;
    const defaultThinkingLevel = meta.reasoningMeta
      ? meta.reasoningMeta.defaultEnabled === false
        ? 'off' as const
        : meta.reasoningMeta.defaultEffort
      : qwen38Preset
        ? 'xhigh' as const
        : inherited?.defaultThinkingLevel;
    const reasoning = meta.reasoning || inherited?.reasoning === true || qwen38Preset;
    const base = {
      id: modelDef.id,
      name: modelDef.name,
      provider: config.id,
      baseUrl,
      reasoning,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
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
      };
    }

    if (config.api === 'openai-responses') {
      return {
        ...base,
        api: 'openai-responses' as const,
      };
    }

    return {
      ...base,
      api: 'openai-completions' as const,
      compat: openAiCompatFlags(config.kind, reasoning, {
        qwenChatTemplate: looksLikeQwenModel(modelDef),
      }),
    };
  });
}

function customProviderRuntimeBaseUrl(config: CustomProviderConfig): string {
  const baseUrl = normalizeProviderBaseUrl(config.baseUrl);
  if (config.api !== 'anthropic-messages') {
    return baseUrl;
  }

  // pi-ai's Anthropic transport appends /v1/messages. Keep /v1 on the
  // persisted discovery URL, but remove it from the runtime API root.
  return baseUrl.replace(/\/v1$/, '');
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
    const reasoningMeta = parseCustomProviderReasoningMeta(
      isRecord(row.reasoning) ? row.reasoning : row.supported_reasoning_efforts,
    );
    const reasoning = reasoningMeta !== undefined
      ? true
      : typeof row.reasoning === 'boolean'
        ? row.reasoning
        : false;
    return [{
      id,
      name,
      ...(contextWindow ? { contextWindow } : {}),
      ...(reasoningMeta || reasoning ? { reasoning } : {}),
      ...(reasoningMeta ? { reasoningMeta } : {}),
    }];
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
  models = mergeFetchedCustomProviderModelUserFields(models, config.models);
  return { models };
}

export function buildCustomPiProvider(
  config: CustomProviderConfig,
  options?: {
    httpGet?: CustomProviderHttpGet;
    getApiKey?: () => string | undefined;
    knownModels?: readonly KnownModelReasoningSource[];
  },
): Provider {
  const baseUrl = customProviderRuntimeBaseUrl(config);
  const knownModels = options?.knownModels;
  const models = buildCustomProviderModels(config, { knownModels });
  const api = resolveApiStreams(config.api);
  const httpGet = options?.httpGet;

  return createProvider({
    id: config.id,
    name: config.name,
    baseUrl: baseUrl || undefined,
    headers: config.headers,
    auth: baseUrl ? buildCustomProviderAuth(config) : buildKeylessAuth(config.name),
    models,
    fetchModels: httpGet
      ? async (context) => {
          const apiKey = options?.getApiKey?.()
            ?? (context.credential?.type === 'api_key' ? context.credential.key : undefined);
          const fetched = await fetchCustomProviderModels(config, httpGet, { apiKey });
          // Mutate config so callers that hold the same object see the list.
          config.models = fetched.models;
          return buildCustomProviderModels({ ...config, models: fetched.models }, { knownModels });
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

  const knownModels = collectKnownModelReasoningSources(
    models,
    new Set(configs.map((config) => config.id)),
  );

  for (const config of configs) {
    models.setProvider(
      buildCustomPiProvider(config, {
        httpGet: options?.httpGet,
        getApiKey: options?.getApiKey
          ? () => options.getApiKey?.(config.id)
          : undefined,
        knownModels,
      }),
    );
  }
}
