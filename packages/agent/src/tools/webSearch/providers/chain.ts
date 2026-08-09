import {
  WEB_PROVIDER_CAPABILITIES,
  type WebProviderId,
} from '../../../foundation/settings';
import {
  isAbortError,
  type ProviderRunError,
  type ProviderRunResult,
  resolveApiKey,
  type WebSearchInput,
  type WebSearchToolDeps,
} from '../types';
import { searchAnySearch } from './anysearch';
import { searchBrave } from './brave';
import { searchExa } from './exa';
import { searchExaMcp } from './exa-mcp';
import { searchTavily } from './tavily';

export async function runProvider(
  deps: WebSearchToolDeps,
  providerId: WebProviderId | 'exa-mcp',
  input: WebSearchInput,
  signal?: AbortSignal,
): Promise<ProviderRunResult | ProviderRunError> {
  try {
    if (providerId === 'exa-mcp') {
      return { response: await searchExaMcp(deps, input, signal) };
    }
    const apiKey = resolveApiKey(deps, providerId);
    if (WEB_PROVIDER_CAPABILITIES[providerId].apiKeyRequired && !apiKey) {
      throw new Error(`${providerName(providerId)} API key not configured.`);
    }
    if (providerId === 'brave') {
      return { response: await searchBrave(deps, input, apiKey!, signal) };
    }
    if (providerId === 'tavily') {
      return { response: await searchTavily(deps, input, apiKey!, signal) };
    }
    if (providerId === 'exa') {
      return { response: await searchExa(deps, input, apiKey!, signal) };
    }
    return { response: await searchAnySearch(deps, input, apiKey, signal) };
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function buildSearchChain(deps: WebSearchToolDeps): (WebProviderId | 'exa-mcp')[] {
  const disabled = new Set(deps.disabledProviders ?? []);
  const chain = deps.providerOrder.filter((providerId) => {
    const capabilities = WEB_PROVIDER_CAPABILITIES[providerId];
    return !disabled.has(providerId)
      && capabilities.search
      && (!capabilities.apiKeyRequired || Boolean(resolveApiKey(deps, providerId)));
  });
  return [...chain, 'exa-mcp'];
}

function providerName(providerId: WebProviderId): string {
  if (providerId === 'anysearch') return 'AnySearch';
  return providerId === 'brave' ? 'Brave' : providerId === 'tavily' ? 'Tavily' : 'Exa';
}
