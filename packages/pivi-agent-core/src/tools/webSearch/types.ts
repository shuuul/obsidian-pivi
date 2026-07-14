import type { WebSearchProviderChoice, WebSearchProviderId } from '../../foundation/settings';

/** Unified search result source entry returned by every provider adapter. */
export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

/** Unified search response shape produced by each provider adapter. */
export interface WebSearchResponse {
  provider: WebSearchProviderId | 'exa-mcp';
  query: string;
  summary?: string;
  sources: WebSearchSource[];
}

/** Fetch function signature (compatible with the global `fetch` and `nodeFetch`). */
export type WebSearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Callback used by the tool to look up a provider API key synchronously. */
export type WebSearchCredentialLookup = (providerId: WebSearchProviderId) => string | undefined;

export type WebFetchProviderId = 'tavily' | 'exa';
export type WebFetchProviderChoice = 'auto' | WebFetchProviderId;

export interface WebSearchToolDeps {
  fetch: WebSearchFetch;
  /** Preferred provider; `auto` uses credential-based chain with Exa MCP fallback. */
  preferredProvider: WebSearchProviderChoice;
  /** Looks up an API key for a provider id from Obsidian keychain or similar. */
  getCredential?: WebSearchCredentialLookup;
  /** Parsed environment variables map for env-based key lookup. */
  environmentVariables?: Record<string, string>;
}

export interface WebFetchToolDeps {
  fetch: WebSearchFetch;
  preferredProvider: WebFetchProviderChoice;
  getCredential?: (providerId: WebSearchProviderId) => string | undefined;
  environmentVariables?: Record<string, string>;
}

export interface WebFetchResponse {
  provider: WebFetchProviderId | 'direct';
  url: string;
  title?: string;
  content: string;
}

export type Recency = 'day' | 'week' | 'month' | 'year';

export const RECENCY_VALUES: readonly Recency[] = ['day', 'week', 'month', 'year'];

export interface WebSearchInput {
  query: string;
  recency?: Recency;
  limit: number;
  provider?: WebSearchProviderChoice;
  num_search_results?: number;
}

export interface WebFetchInput {
  url: string;
  query?: string;
  maxChars: number;
  provider?: WebFetchProviderChoice;
}

export interface ProviderRunResult {
  response: WebSearchResponse;
  error?: undefined;
}

export interface ProviderRunError {
  response?: undefined;
  error: Error;
}

export function isRecency(value: unknown): value is Recency {
  return typeof value === 'string' && (RECENCY_VALUES as readonly string[]).includes(value);
}

export function isWebSearchProviderValue(value: unknown): value is WebSearchProviderChoice {
  return value === 'auto' || value === 'brave' || value === 'tavily' || value === 'exa';
}

export function asJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function resolveApiKey(
  deps: Pick<WebSearchToolDeps, 'getCredential' | 'environmentVariables'>,
  providerId: WebSearchProviderId,
): string | undefined {
  const fromCred = deps.getCredential?.(providerId);
  if (fromCred && fromCred.trim()) {
    return fromCred.trim();
  }
  const envVar = providerApiKeyEnvVar(providerId);
  const fromEnv = envVar ? deps.environmentVariables?.[envVar] : undefined;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : undefined;
}

export function providerApiKeyEnvVar(providerId: WebSearchProviderId): string | undefined {
  if (providerId === 'brave') return 'BRAVE_API_KEY';
  if (providerId === 'tavily') return 'TAVILY_API_KEY';
  if (providerId === 'exa') return 'EXA_API_KEY';
  return undefined;
}

/** Brave freshness param mapping from recency. */
export function braveFreshness(recency: Recency | undefined): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'pd';
  if (recency === 'week') return 'pw';
  if (recency === 'month') return 'pm';
  return 'py';
}

/** Tavily time_range param mapping from recency. */
export function tavilyTimeRange(recency: Recency | undefined): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'day';
  if (recency === 'week') return 'week';
  if (recency === 'month') return 'month';
  return 'year';
}

export function publishedDateCutoff(recency: Recency): string {
  const now = new Date();
  if (recency === 'day') now.setUTCDate(now.getUTCDate() - 1);
  else if (recency === 'week') now.setUTCDate(now.getUTCDate() - 7);
  else if (recency === 'month') now.setUTCMonth(now.getUTCMonth() - 1);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString().slice(0, 10);
}
