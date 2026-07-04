import { WEB_SEARCH_PROVIDER_IDS, type WebSearchProviderChoice, type WebSearchProviderId } from '@pivi/pivi-agent-core/foundation/settings';

import { TOOL_WEB_FETCH, TOOL_WEB_SEARCH } from './toolNames';
import type { ToolSpec } from './toolSpec';

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



type Recency = 'day' | 'week' | 'month' | 'year';

const RECENCY_VALUES: readonly Recency[] = ['day', 'week', 'month', 'year'];

function isRecency(value: unknown): value is Recency {
  return typeof value === 'string' && (RECENCY_VALUES as readonly string[]).includes(value);
}

interface WebSearchInput {
  query: string;
  recency?: Recency;
  limit: number;
  provider?: WebSearchProviderChoice;
  num_search_results?: number;
}

function parseInput(params: unknown): WebSearchInput {
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

function isWebSearchProviderValue(value: unknown): value is WebSearchProviderChoice {
  return value === 'auto' || value === 'brave' || value === 'tavily' || value === 'exa';
}

function resolveApiKey(
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

function providerApiKeyEnvVar(providerId: WebSearchProviderId): string | undefined {
  if (providerId === 'brave') return 'BRAVE_API_KEY';
  if (providerId === 'tavily') return 'TAVILY_API_KEY';
  if (providerId === 'exa') return 'EXA_API_KEY';
  return undefined;
}

/** Brave freshness param mapping from recency. */
function braveFreshness(recency: Recency | undefined): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'pd';
  if (recency === 'week') return 'pw';
  if (recency === 'month') return 'pm';
  return 'py';
}

/** Tavily time_range param mapping from recency. */
function tavilyTimeRange(recency: Recency | undefined): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'day';
  if (recency === 'week') return 'week';
  if (recency === 'month') return 'month';
  return 'year';
}

function asJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function searchBrave(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', input.query);
  url.searchParams.set('count', String(input.limit));
  const freshness = braveFreshness(input.recency);
  if (freshness) {
    url.searchParams.set('freshness', freshness);
  }

  const response = await deps.fetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-subscription-token': apiKey,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = asJson(await response.json());
  if (!body) {
    throw new Error('Brave search returned a non-object response body.');
  }

  const web = asJson(body.web);
  const results = asArray(web?.results) ?? [];
  const sources: WebSearchSource[] = [];
  for (const entry of results.slice(0, input.limit)) {
    const record = asJson(entry);
    if (!record) continue;
    const title = asString(record.title) ?? '';
    const link = asString(record.url) ?? asString(record.link) ?? '';
    if (!title || !link) continue;
    const source: WebSearchSource = { title, url: link };
    const description = asString(record.description);
    if (description) source.snippet = description;
    sources.push(source);
  }

  return { provider: 'brave', query: input.query, sources };
}

async function searchTavily(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const payload: Record<string, unknown> = {
    query: input.query,
    max_results: input.limit,
    search_depth: 'basic',
    include_answer: 'advanced',
  };
  const timeRange = tavilyTimeRange(input.recency);
  if (timeRange) {
    payload.time_range = timeRange;
  }

  const doRequest = async (body: Record<string, unknown>): Promise<WebSearchResponse> => {
    const response = await deps.fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed: HTTP ${response.status} ${response.statusText}`);
    }
    const parsed = asJson(await response.json());
    if (!parsed) {
      throw new Error('Tavily search returned a non-object response body.');
    }
    const rawResults = asArray(parsed.results) ?? [];
    const sources: WebSearchSource[] = [];
    for (const entry of rawResults.slice(0, input.limit)) {
      const record = asJson(entry);
      if (!record) continue;
      const title = asString(record.title) ?? '';
      const link = asString(record.url) ?? '';
      if (!title || !link) continue;
      const source: WebSearchSource = { title, url: link };
      const content = asString(record.content);
      if (content) source.snippet = content;
      sources.push(source);
    }
    const answer = asString(parsed.answer);
    return { provider: 'tavily', query: input.query, summary: answer, sources };
  };

  try {
    const result = await doRequest(payload);
    // Retry without recency filter when a recency-filtered query returns no renderable content.
    if (input.recency && result.sources.length === 0 && !result.summary) {
      const relaxed = { ...payload };
      delete relaxed.time_range;
      return doRequest(relaxed);
    }
    return result;
  } catch (error) {
    if (input.recency) {
      const relaxed = { ...payload };
      delete relaxed.time_range;
      return doRequest(relaxed);
    }
    throw error;
  }
}

async function searchExa(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const payload: Record<string, unknown> = {
    query: input.query,
    numResults: input.limit,
    contents: { text: { maxCharacters: 200 } },
  };
  if (input.recency) {
    payload.startPublishedDate = publishedDateCutoff(input.recency);
  }

  const response = await deps.fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Exa search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Exa search returned a non-object response body.');
  }
  const rawResults = asArray(parsed.results) ?? [];
  const sources: WebSearchSource[] = [];
  for (const entry of rawResults.slice(0, input.limit)) {
    const record = asJson(entry);
    if (!record) continue;
    const title = asString(record.title) ?? '';
    const link = asString(record.url) ?? '';
    if (!title || !link) continue;
    const source: WebSearchSource = { title, url: link };
    const textRecord = asJson(record.text);
    const text = asString(textRecord?.text);
    if (text) source.snippet = text;
    sources.push(source);
  }
  return { provider: 'exa', query: input.query, sources };
}

function publishedDateCutoff(recency: Recency): string {
  const now = new Date();
  if (recency === 'day') now.setUTCDate(now.getUTCDate() - 1);
  else if (recency === 'week') now.setUTCDate(now.getUTCDate() - 7);
  else if (recency === 'month') now.setUTCMonth(now.getUTCMonth() - 1);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString().split('T')[0];
}

async function searchExaMcp(
  deps: WebSearchToolDeps,
  input: WebSearchInput,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  // Exa public MCP fallback: a single POST that searches the web via the public endpoint.
  const response = await deps.fetch('https://mcp.exa.ai/mcp?tools=web_search_exa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: input.query,
          numResults: input.limit,
          startPublishedDate: input.recency ? publishedDateCutoff(input.recency) : undefined,
        },
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Exa MCP search failed: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Exa MCP search returned a non-object response body.');
  }
  const result = asJson(parsed.result);
  const content = asArray(result?.content) ?? [];
  let text: string | undefined;
  for (const entry of content) {
    const record = asJson(entry);
    if (record && record.type === 'text') {
      const candidate = asString(record.text);
      if (candidate) {
        text = candidate;
        break;
      }
    }
  }
  if (!text) {
    return { provider: 'exa-mcp', query: input.query, sources: [] };
  }
  const sources = parseExaMcpText(text, input.limit);
  return { provider: 'exa-mcp', query: input.query, sources };
}

function parseExaMcpText(text: string, limit: number): WebSearchSource[] {
  // The Exa MCP text content is a newline-delimited list of "<title> - <url>" entries
  // or JSON-encoded results. Try JSON first, fall back to line parsing.
  try {
    const parsed: unknown = JSON.parse(text);
    const arr = asArray(parsed);
    if (arr) {
      const sources: WebSearchSource[] = [];
      for (const entry of arr.slice(0, limit)) {
        const record = asJson(entry);
        if (!record) continue;
        const title = asString(record.title) ?? '';
        const url = asString(record.url) ?? '';
        if (title && url) sources.push({ title, url });
      }
      if (sources.length > 0) return sources;
    }
  } catch {
    // Not JSON; fall through to line parsing.
  }
  const sources: WebSearchSource[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const dashIndex = trimmed.lastIndexOf(' - ');
    if (dashIndex > 0) {
      const title = trimmed.slice(0, dashIndex).trim();
      const url = trimmed.slice(dashIndex + 3).trim();
      if (title && /^https?:\/\//i.test(url)) {
        sources.push({ title, url });
      }
    }
    if (sources.length >= limit) break;
  }
  return sources;
}

interface ProviderRunResult {
  response: WebSearchResponse;
  error?: undefined;
}

interface ProviderRunError {
  response?: undefined;
  error: Error;
}

async function runProvider(
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

function buildAutoChain(
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

function formatResponse(response: WebSearchResponse): string {
  const links = response.sources.map((source) => ({
    title: source.title,
    url: source.url,
  }));
  const lines: string[] = [];
  lines.push(`Links: ${JSON.stringify(links)}`);
  lines.push(`Provider: ${response.provider}`);
  lines.push(`Query: ${response.query}`);
  if (response.summary) {
    lines.push(`Summary: ${response.summary}`);
  }
  const snippets = response.sources
    .filter((source) => source.snippet)
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${source.snippet}`);
  if (snippets.length > 0) {
    lines.push('Sources:');
    lines.push(...snippets);
  }
  return lines.join('\n');
}

const WEB_FETCH_PROVIDER_IDS: readonly WebFetchProviderId[] = ['tavily', 'exa'];
const WEB_FETCH_PROVIDER_CHOICES: readonly WebFetchProviderChoice[] = ['auto', 'tavily', 'exa'];
const DEFAULT_WEB_FETCH_MAX_CHARS = 12000;
const MIN_WEB_FETCH_MAX_CHARS = 500;
const MAX_WEB_FETCH_MAX_CHARS = 20000;

interface WebFetchInput {
  url: string;
  query?: string;
  maxChars: number;
  provider?: WebFetchProviderChoice;
}

function isWebFetchProviderValue(value: unknown): value is WebFetchProviderChoice {
  return typeof value === 'string' && (WEB_FETCH_PROVIDER_CHOICES as readonly string[]).includes(value);
}

function clampWebFetchMaxChars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_WEB_FETCH_MAX_CHARS;
  }
  return Math.max(MIN_WEB_FETCH_MAX_CHARS, Math.min(Math.floor(value), MAX_WEB_FETCH_MAX_CHARS));
}

function parseFetchInput(params: unknown): WebFetchInput {
  if (!params || typeof params !== 'object') {
    throw new Error('WebFetch input must be an object.');
  }
  const record = params as Record<string, unknown>;
  const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';
  if (!rawUrl) {
    throw new Error('Invalid WebFetch input: url is required.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('Invalid WebFetch input: url must be http(s).');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid WebFetch input: url must be http(s).');
  }
  const query = typeof record.query === 'string' && record.query.trim()
    ? record.query.trim()
    : undefined;
  const provider = isWebFetchProviderValue(record.provider) ? record.provider : undefined;
  return {
    url: parsedUrl.toString(),
    query,
    maxChars: clampWebFetchMaxChars(record.maxChars),
    provider,
  };
}

function isHtmlContent(content: string): boolean {
  return /<html|<body|<article|<p[\s>]/i.test(content);
}

function stripHtmlContent(content: string): string {
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeFetchedContent(content: string, maxChars: number): string {
  const text = (isHtmlContent(content) ? stripHtmlContent(content) : content)
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxChars).trim();
}

async function fetchTavily(
  deps: WebFetchToolDeps,
  input: WebFetchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebFetchResponse> {
  const payload: Record<string, unknown> = {
    urls: input.url,
    extract_depth: 'basic',
    format: 'markdown',
    timeout: 20,
  };
  if (input.query) {
    payload.query = input.query;
  }
  const response = await deps.fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Tavily fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Tavily fetch returned a non-object response body.');
  }
  const results = asArray(parsed.results) ?? [];
  if (results.length === 0) {
    throw new Error('Tavily fetch returned no results.');
  }
  const matched = results
    .map((entry) => asJson(entry))
    .find((entry) => entry && asString(entry.url) === input.url)
    ?? asJson(results[0]);
  const content = matched ? asString(matched.raw_content)?.trim() : undefined;
  if (!content) {
    throw new Error('Tavily fetch returned no readable content.');
  }
  return { provider: 'tavily', url: asString(matched?.url) ?? input.url, content: content.slice(0, input.maxChars) };
}

async function fetchExa(
  deps: WebFetchToolDeps,
  input: WebFetchInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebFetchResponse> {
  const payload: Record<string, unknown> = {
    urls: [input.url],
    text: { maxCharacters: input.maxChars, includeHtmlTags: false },
  };
  if (input.query) {
    payload.summary = { query: input.query };
  }
  const response = await deps.fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Exa fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const parsed = asJson(await response.json());
  if (!parsed) {
    throw new Error('Exa fetch returned a non-object response body.');
  }
  const results = asArray(parsed.results) ?? [];
  if (results.length === 0) {
    throw new Error('Exa fetch returned no results.');
  }
  const record = asJson(results[0]);
  const content = (record ? asString(record.text) ?? asString(record.summary) : undefined)?.trim();
  if (!content) {
    throw new Error('Exa fetch returned no readable content.');
  }
  const title = record ? asString(record.title) : undefined;
  const url = record ? asString(record.url) ?? input.url : input.url;
  return title ? { provider: 'exa', url, title, content } : { provider: 'exa', url, content };
}

async function fetchDirect(
  deps: WebFetchToolDeps,
  input: WebFetchInput,
  signal?: AbortSignal,
): Promise<WebFetchResponse> {
  const response = await deps.fetch(input.url, {
    method: 'GET',
    headers: {
      accept: 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.8',
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Direct web fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const content = normalizeFetchedContent(await response.text(), input.maxChars);
  if (!content) {
    throw new Error('Direct web fetch returned no readable content.');
  }
  return { provider: 'direct', url: input.url, content };
}

function buildFetchChain(deps: WebFetchToolDeps): (WebFetchProviderId | 'direct')[] {
  const chain: (WebFetchProviderId | 'direct')[] = [];
  const seen = new Set<WebFetchProviderId>();
  const pushIfCredentialed = (providerId: WebFetchProviderId) => {
    if (!seen.has(providerId) && resolveApiKey(deps, providerId)) {
      seen.add(providerId);
      chain.push(providerId);
    }
  };
  if (deps.preferredProvider !== 'auto') {
    pushIfCredentialed(deps.preferredProvider);
  }
  for (const providerId of WEB_FETCH_PROVIDER_IDS) {
    pushIfCredentialed(providerId);
  }
  chain.push('direct');
  return chain;
}

async function runFetchProvider(
  deps: WebFetchToolDeps,
  providerId: WebFetchProviderId | 'direct',
  input: WebFetchInput,
  signal?: AbortSignal,
): Promise<WebFetchResponse> {
  if (providerId === 'direct') {
    return fetchDirect(deps, input, signal);
  }
  const apiKey = resolveApiKey(deps, providerId);
  if (!apiKey) {
    throw new Error(`${providerId === 'tavily' ? 'Tavily' : 'Exa'} API key not configured.`);
  }
  if (providerId === 'tavily') {
    return fetchTavily(deps, input, apiKey, signal);
  }
  return fetchExa(deps, input, apiKey, signal);
}

function formatFetchResponse(response: WebFetchResponse): string {
  const lines = [`URL: ${response.url}`, `Provider: ${response.provider}`];
  if (response.title) {
    lines.push(`Title: ${response.title}`);
  }
  lines.push('', response.content);
  return lines.join('\n');
}

export function createWebFetchTool(deps: WebFetchToolDeps): ToolSpec {
  return {
    name: TOOL_WEB_FETCH,
    label: 'Web fetch',
    description: 'Fetch readable content from a web URL. Uses Tavily Extract or Exa Contents when configured, with direct HTTP fallback.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL to fetch.' },
        query: { type: 'string', description: 'Optional intent/query for provider-side extraction or summary.' },
        maxChars: { type: 'number', description: 'Maximum characters to return (500-20000, default 12000).' },
        provider: {
          type: 'string',
          enum: ['auto', 'tavily', 'exa'],
          description: 'Override configured fetch provider for this call. Omit to use preferred/fallback chain.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    metadata: {
      displayKind: 'search',
    },
    async execute(_toolCallId, params, signal) {
      const input = parseFetchInput(params);
      if (input.provider && input.provider !== 'auto') {
        const response = await runFetchProvider(deps, input.provider, input, signal);
        return { content: [{ type: 'text', text: formatFetchResponse(response) }] };
      }

      const errors: string[] = [];
      for (const providerId of buildFetchChain(deps)) {
        try {
          const response = await runFetchProvider(deps, providerId, input, signal);
          if (response.content.trim()) {
            return { content: [{ type: 'text', text: formatFetchResponse(response) }] };
          }
          errors.push(`${providerId}: no content`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${providerId}: ${message}`);
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: `No web fetch content found for URL "${input.url}". Tried: ${errors.join('; ')}`,
          },
        ],
      };
    },
  };
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
