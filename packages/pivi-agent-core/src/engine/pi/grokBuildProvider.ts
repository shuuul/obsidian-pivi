import {
  createProvider,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from '@earendil-works/pi-ai';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

import { GROK_BUILD_PROVIDER_ID } from '../../auth/piProviderCredentials';

export const GROK_BUILD_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';

const GROK_CLIENT_VERSION = '0.2.91';
const GROK_BUILD_HEADERS = {
  'User-Agent': `grok-pager/${GROK_CLIENT_VERSION} grok-shell/${GROK_CLIENT_VERSION} (macos; aarch64)`,
  'x-grok-client-identifier': 'grok-pager',
  'x-grok-client-version': GROK_CLIENT_VERSION,
  'x-xai-token-auth': 'xai-grok-cli',
} as const;

type GrokBuildModel = Model<'openai-responses'>;

function model(
  id: string,
  name: string,
  options: {
    reasoning: boolean;
    contextWindow: number;
    cost: GrokBuildModel['cost'];
  },
): GrokBuildModel {
  return {
    id,
    name,
    api: 'openai-responses',
    provider: GROK_BUILD_PROVIDER_ID,
    baseUrl: GROK_BUILD_BASE_URL,
    reasoning: options.reasoning,
    thinkingLevelMap: options.reasoning
      ? undefined
      : { off: 'none', minimal: null, low: null, medium: null, high: null, xhigh: null, max: null },
    input: ['text'],
    cost: options.cost,
    contextWindow: options.contextWindow,
    maxTokens: 30_000,
    headers: {
      ...GROK_BUILD_HEADERS,
      'x-grok-model-override': id,
    },
    compat: {
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
    },
  };
}

export const GROK_BUILD_MODELS: readonly GrokBuildModel[] = [
  model('grok-composer-2.5-fast', 'Composer 2.5 Fast (Grok CLI)', {
    reasoning: false,
    contextWindow: 200_000,
    cost: { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 0 },
  }),
  model('grok-build', 'Grok Build', {
    reasoning: true,
    contextWindow: 512_000,
    cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0.2 },
  }),
  model('grok-4.3', 'Grok 4.3', {
    reasoning: true,
    contextWindow: 1_000_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
  model('grok-4.5', 'Grok 4.5', {
    reasoning: true,
    contextWindow: 500_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
  model('grok-4.20-0309-reasoning', 'Grok 4.20 Reasoning', {
    reasoning: true,
    contextWindow: 2_000_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
  model('grok-4.20-0309-non-reasoning', 'Grok 4.20 Non-Reasoning', {
    reasoning: false,
    contextWindow: 2_000_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
  model('grok-4.20-0309-multi-agent', 'Grok 4.20 Multi-Agent', {
    reasoning: true,
    contextWindow: 2_000_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (!isRecord(part)) {
        return '';
      }
      return typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Normalize pi-ai's Responses payload to the Grok Build proxy contract. */
export function sanitizeGrokBuildPayload(payload: unknown, sessionId?: string): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const next = { ...payload };
  const instructions: string[] = [];
  if (typeof next.instructions === 'string' && next.instructions.trim()) {
    instructions.push(next.instructions);
  }
  if (Array.isArray(next.input)) {
    next.input = next.input.filter((item) => {
      if (typeof item === 'string') {
        return item.length > 0;
      }
      if (!isRecord(item) || item.type === 'reasoning') {
        return false;
      }
      if (item.role === 'system' || item.role === 'developer') {
        const text = contentText(item.content);
        if (text) {
          instructions.push(text);
        }
        return false;
      }
      return item.content !== '';
    });
  }
  if (instructions.length > 0) {
    next.instructions = instructions.join('\n\n');
  }

  if (isRecord(next.response_format)) {
    const text = isRecord(next.text) ? { ...next.text } : {};
    text.format = next.response_format;
    next.text = text;
  }
  delete next.response_format;
  delete next.prompt_cache_retention;
  if (sessionId && !next.prompt_cache_key) {
    next.prompt_cache_key = sessionId;
  }
  if (Array.isArray(next.include)) {
    const include = next.include.filter((entry) => entry !== 'reasoning.encrypted_content');
    next.include = include;
    if (include.length === 0) {
      delete next.include;
    }
  }
  return next;
}

function withGrokPayloadTransform<T extends StreamOptions>(options?: T): T {
  const callerTransform = options?.onPayload;
  return {
    ...options,
    onPayload: async (payload, requestModel) => {
      const callerPayload = await callerTransform?.(payload, requestModel);
      return sanitizeGrokBuildPayload(callerPayload ?? payload, options?.sessionId);
    },
  } as T;
}

function grokBuildApi(): ProviderStreams {
  const api = openAIResponsesApi();
  return {
    stream: (requestModel, context, options) => (
      api.stream(requestModel, context, withGrokPayloadTransform(options))
    ),
    streamSimple: (requestModel, context, options?: SimpleStreamOptions) => (
      api.streamSimple(requestModel, context, withGrokPayloadTransform(options))
    ),
  };
}

export function createGrokBuildProvider(xai: Provider): Provider<'openai-responses'> {
  if (!xai.auth.oauth) {
    throw new Error('xAI does not expose OAuth authentication for Grok Build.');
  }
  return createProvider({
    id: GROK_BUILD_PROVIDER_ID,
    name: 'Grok Build',
    baseUrl: GROK_BUILD_BASE_URL,
    auth: { oauth: xai.auth.oauth },
    models: GROK_BUILD_MODELS,
    api: grokBuildApi(),
  });
}
