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
  options?: { headers?: Record<string, string> },
) => Promise<{ status: number; body: string }>;

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
    const meta = defaultModelMeta(modelDef);
    const base = {
      id: modelDef.id,
      name: modelDef.name,
      provider: config.id,
      baseUrl,
      reasoning: meta.reasoning,
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

export async function fetchCustomProviderModels(
  config: CustomProviderConfig,
  httpGet: CustomProviderHttpGet,
  options?: { apiKey?: string },
): Promise<CustomProviderFetchResult> {
  const baseUrl = normalizeProviderBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error('Base URL is required.');
  }

  const url = modelsListUrl(baseUrl);
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

  const response = await httpGet(url, { headers });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Model list failed (${response.status}): ${response.body.slice(0, 200)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch {
    throw new Error('Model list response was not valid JSON.');
  }

  const models = parseOpenAiStyleModelsList(payload);
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
