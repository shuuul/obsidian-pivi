import { TOOL_WEB_SEARCH } from '../toolNames';
import type { ToolSpec } from '../toolSpec';
import {
  createWebSearchCredentialStore,
  getWebSearchCredentialSecretId,
  WebSearchCredentialStore,
} from './credentialStore';
import { createWebFetchTool } from './fetch';
import { formatResponse } from './format';
import { buildSearchChain, runProvider } from './providers/chain';
import {
  isRecency,
  providerApiKeyEnvVar,
  type WebFetchProviderId,
  type WebFetchResponse,
  type WebFetchToolDeps,
  type WebSearchCredentialLookup,
  type WebSearchFetch,
  type WebSearchResponse,
  type WebSearchSource,
  type WebSearchToolDeps,
} from './types';

export {
  createWebFetchTool,
  createWebSearchCredentialStore,
  getWebSearchCredentialSecretId,
  providerApiKeyEnvVar,
  WebSearchCredentialStore,
};
export type {
  WebFetchProviderId,
  WebFetchResponse,
  WebFetchToolDeps,
  WebSearchCredentialLookup,
  WebSearchFetch,
  WebSearchResponse,
  WebSearchSource,
  WebSearchToolDeps,
};

function parseInput(params: unknown) {
  if (!params || typeof params !== 'object') {
    throw new Error('WebSearch input must be an object.');
  }
  const record = params as Record<string, unknown>;
  const query = typeof record.query === 'string' ? record.query.trim() : '';
  if (!query) {
    throw new Error('WebSearch input requires a non-empty `query`.');
  }
  const recency = isRecency(record.recency) ? record.recency : undefined;
  const limitRaw = record.limit ?? record.num_search_results;
  const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 20)
    : 10;
  return { query, recency, limit };
}

export function createWebSearchTool(deps: WebSearchToolDeps): ToolSpec {
  return {
    name: TOOL_WEB_SEARCH,
    label: 'Web search',
    description:
      'Search the web for up-to-date information. Tries enabled providers in the user-configured order and falls back when a provider is unavailable or exhausted.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        recency: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Optional recency filter for results.',
        },
        limit: { type: 'number', description: 'Maximum number of results to return (1-20, default 10).' },
        num_search_results: { type: 'number', description: 'Alias for `limit`.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    metadata: {
      displayKind: 'search',
    },
    async execute(_toolCallId, params, signal) {
      const input = parseInput(params);

      const chain = buildSearchChain(deps);
      const errors: string[] = [];
      for (const providerId of chain) {
        const result = await runProvider(deps, providerId, input, signal);
        if (result.error) {
          errors.push(`${providerId}: ${result.error.message}`);
          continue;
        }
        if (result.response.sources.length > 0) {
          return { content: [{ type: 'text', text: formatResponse(result.response) }] };
        }
        errors.push(`${providerId}: no results`);
      }

      throw new Error(`No web search results found for query "${input.query}". Tried: ${errors.join('; ')}`);
    },
  };
}
