import { TOOL_WEB_SEARCH } from '../toolNames';
import type { ToolSpec } from '../toolSpec';
import {
  createWebSearchCredentialStore,
  getWebSearchCredentialSecretId,
  WebSearchCredentialStore,
} from './credentialStore';
import { createWebFetchTool } from './fetch';
import { formatResponse } from './format';
import { buildAutoChain, runProvider } from './providers/chain';
import {
  isRecency,
  isWebSearchProviderValue,
  type WebFetchProviderChoice,
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
  WebSearchCredentialStore,
};
export type {
  WebFetchProviderChoice,
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
  const provider = isWebSearchProviderValue(record.provider) ? record.provider : undefined;
  return { query, recency, limit, provider };
}

export function createWebSearchTool(deps: WebSearchToolDeps): ToolSpec {
  return {
    name: TOOL_WEB_SEARCH,
    label: 'Web search',
    description:
      'Search the web for up-to-date information. Returns a list of links with titles, plus optional summary and source snippets. Supports Brave, Tavily, and Exa providers; auto mode uses configured credentials with an Exa public fallback.',
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
        provider: {
          type: 'string',
          enum: ['auto', 'brave', 'tavily', 'exa'],
          description: 'Override the configured provider for this call. Omit to use the preferred/chain.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    metadata: {
      displayKind: 'search',
    },
    async execute(_toolCallId, params, signal) {
      const input = parseInput(params);

      // Skip `auto` — same as omitting; falls through to preferred chain.
      if (input.provider && input.provider !== 'auto') {
        const result = await runProvider(deps, input.provider, input, signal);
        if (result.error) {
          throw result.error;
        }
        return { content: [{ type: 'text', text: formatResponse(result.response) }] };
      }

      const chain = buildAutoChain(deps);
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

      return {
        content: [
          {
            type: 'text',
            text: `No web search results found for query "${input.query}". Tried: ${errors.join('; ')}`,
          },
        ],
      };
    },
  };
}
