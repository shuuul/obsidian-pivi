import {
  type Api,
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

function toGrokBuildModel(source: Model<Api>): GrokBuildModel {
  return {
    ...source,
    api: 'openai-responses',
    provider: GROK_BUILD_PROVIDER_ID,
    baseUrl: GROK_BUILD_BASE_URL,
    headers: {
      ...source.headers,
      ...GROK_BUILD_HEADERS,
      'x-grok-model-override': source.id,
    },
    compat: {
      ...source.compat,
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
    },
  };
}

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
    models: xai.getModels().map(toGrokBuildModel),
    api: grokBuildApi(),
  });
}
