import type { WebFetchMode, WebProviderId } from '../../foundation/settings';

export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchResponse {
  provider: WebProviderId | 'exa-mcp';
  query: string;
  summary?: string;
  sources: WebSearchSource[];
}

export type WebSearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type WebSearchCredentialLookup = (providerId: WebProviderId) => string | undefined;
export type WebFetchProviderId = Exclude<WebProviderId, 'brave'>;

interface OrderedWebProviderDeps {
  fetch: WebSearchFetch;
  providerOrder: readonly WebProviderId[];
  disabledProviders?: readonly WebProviderId[];
  getCredential?: WebSearchCredentialLookup;
  environmentVariables?: Record<string, string>;
}

export type WebSearchToolDeps = OrderedWebProviderDeps;
export type WebFetchToolDeps = OrderedWebProviderDeps & {
  /** Defaults to direct-only when omitted. */
  fetchMode?: WebFetchMode;
};

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
  num_search_results?: number;
}

export interface WebFetchInput {
  url: string;
  query?: string;
  maxChars: number;
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

export function asJson(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function resolveApiKey(
  deps: Pick<OrderedWebProviderDeps, 'getCredential' | 'environmentVariables'>,
  providerId: WebProviderId,
): string | undefined {
  const fromCredential = deps.getCredential?.(providerId)?.trim();
  if (fromCredential) return fromCredential;
  const fromEnvironment = deps.environmentVariables?.[providerApiKeyEnvVar(providerId)]?.trim();
  return fromEnvironment || undefined;
}

export function providerApiKeyEnvVar(providerId: WebProviderId): string {
  if (providerId === 'brave') return 'BRAVE_API_KEY';
  if (providerId === 'tavily') return 'TAVILY_API_KEY';
  if (providerId === 'exa') return 'EXA_API_KEY';
  return 'ANYSEARCH_API_KEY';
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
}

export function braveFreshness(recency: Recency | undefined): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'pd';
  if (recency === 'week') return 'pw';
  if (recency === 'month') return 'pm';
  return 'py';
}

export function tavilyTimeRange(recency: Recency | undefined): string | undefined {
  return recency;
}

export function publishedDateCutoff(recency: Recency): string {
  const now = new Date();
  if (recency === 'day') now.setUTCDate(now.getUTCDate() - 1);
  else if (recency === 'week') now.setUTCDate(now.getUTCDate() - 7);
  else if (recency === 'month') now.setUTCMonth(now.getUTCMonth() - 1);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString().slice(0, 10);
}
