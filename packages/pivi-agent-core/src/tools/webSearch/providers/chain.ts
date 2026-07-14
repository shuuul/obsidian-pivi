import { WEB_SEARCH_PROVIDER_IDS, type WebSearchProviderId } from '../../../foundation/settings';
import {
  type ProviderRunError,
  type ProviderRunResult,
  resolveApiKey,
  type WebSearchInput,
  type WebSearchToolDeps,
} from '../types';
import { searchBrave } from './brave';
import { searchExa } from './exa';
import { searchExaMcp } from './exa-mcp';
import { searchTavily } from './tavily';

export async function runProvider(
  deps: WebSearchToolDeps,
  providerId: WebSearchProviderId | 'exa-mcp',
  input: WebSearchInput,
  signal?: AbortSignal,
): Promise<ProviderRunResult | ProviderRunError> {
  try {
    if (providerId === 'brave') {
      const apiKey = resolveApiKey(deps, 'brave');
      if (!apiKey) throw new Error('Brave API key not configured.');
      return { response: await searchBrave(deps, input, apiKey, signal) };
    }
    if (providerId === 'tavily') {
      const apiKey = resolveApiKey(deps, 'tavily');
      if (!apiKey) throw new Error('Tavily API key not configured.');
      return { response: await searchTavily(deps, input, apiKey, signal) };
    }
    if (providerId === 'exa') {
      const apiKey = resolveApiKey(deps, 'exa');
      if (!apiKey) throw new Error('Exa API key not configured.');
      return { response: await searchExa(deps, input, apiKey, signal) };
    }
    // exa-mcp fallback (no key required)
    return { response: await searchExaMcp(deps, input, signal) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function buildAutoChain(
  deps: WebSearchToolDeps,
): (WebSearchProviderId | 'exa-mcp')[] {
  // Preferred provider first (if credentialed), then others in canonical order, then Exa MCP fallback.
  const chain: (WebSearchProviderId | 'exa-mcp')[] = [];
  const seen = new Set<WebSearchProviderId>();

  const pushIfCredentialed = (id: WebSearchProviderId) => {
    if (!seen.has(id) && resolveApiKey(deps, id)) {
      seen.add(id);
      chain.push(id);
    }
  };

  if (deps.preferredProvider !== 'auto') {
    pushIfCredentialed(deps.preferredProvider);
  }
  for (const id of WEB_SEARCH_PROVIDER_IDS) {
    pushIfCredentialed(id);
  }
  chain.push('exa-mcp');
  return chain;
}
