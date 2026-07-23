import { WEB_PROVIDER_CAPABILITIES } from '../../foundation/settings';
import { redactUrl } from '../../network/urlPolicy';
import { TOOL_WEB_FETCH } from '../toolNames';
import type { ToolSpec } from '../toolSpec';
import { formatFetchResponse } from './format';
import { fetchAnySearch } from './providers/anysearch';
import {
  asArray,
  asJson,
  asString,
  isAbortError,
  resolveApiKey,
  type WebFetchInput,
  type WebFetchProviderId,
  type WebFetchResponse,
  type WebFetchToolDeps,
} from './types';

const DEFAULT_WEB_FETCH_MAX_CHARS = 12000;
const MIN_WEB_FETCH_MAX_CHARS = 500;
const MAX_WEB_FETCH_MAX_CHARS = 20000;

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
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Invalid WebFetch input: URL credentials are not allowed.');
  }
  const query = typeof record.query === 'string' && record.query.trim()
    ? record.query.trim()
    : undefined;
  return {
    url: parsedUrl.toString(),
    query,
    maxChars: clampWebFetchMaxChars(record.maxChars),
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
  // Transport already streams with byte limits; character truncation remains a product cap.
  const content = normalizeFetchedContent(await response.text(), input.maxChars);
  if (!content) {
    throw new Error('Direct web fetch returned no readable content.');
  }
  return { provider: 'direct', url: input.url, content };
}

function buildFetchChain(deps: WebFetchToolDeps): (WebFetchProviderId | 'direct')[] {
  const disabled = new Set(deps.disabledProviders ?? []);
  const providers = deps.providerOrder.filter((providerId): providerId is WebFetchProviderId => {
    const capabilities = WEB_PROVIDER_CAPABILITIES[providerId];
    return !disabled.has(providerId)
      && capabilities.fetch
      && (!capabilities.apiKeyRequired || Boolean(resolveApiKey(deps, providerId)));
  });
  return [...providers, 'direct'];
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
  if (WEB_PROVIDER_CAPABILITIES[providerId].apiKeyRequired && !apiKey) {
    throw new Error(`${providerId === 'tavily' ? 'Tavily' : 'Exa'} API key not configured.`);
  }
  if (providerId === 'tavily') {
    return fetchTavily(deps, input, apiKey!, signal);
  }
  if (providerId === 'exa') {
    return fetchExa(deps, input, apiKey!, signal);
  }
  return fetchAnySearch(deps, input, apiKey, signal);
}

export function createWebFetchTool(deps: WebFetchToolDeps): ToolSpec {
  return {
    name: TOOL_WEB_FETCH,
    label: 'Web fetch',
    description: 'Fetch readable content from a web URL. Tries enabled extractors in the user-configured order, with direct HTTP fallback. Extractors receive the full target URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL to fetch.' },
        query: { type: 'string', description: 'Optional intent/query for provider-side extraction or summary.' },
        maxChars: { type: 'number', description: 'Maximum characters to return (500-20000, default 12000).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    metadata: {
      displayKind: 'search',
    },
    async execute(_toolCallId, params, signal) {
      const input = parseFetchInput(params);
      const errors: string[] = [];
      for (const providerId of buildFetchChain(deps)) {
        try {
          const response = await runFetchProvider(deps, providerId, input, signal);
          if (response.content.trim()) {
            return { content: [{ type: 'text', text: formatFetchResponse(response) }] };
          }
          errors.push(`${providerId}: no content`);
        } catch (error) {
          if (isAbortError(error, signal)) throw error;
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${providerId}: ${message}`);
        }
      }
      throw new Error(
        `No web fetch content found for URL "${redactUrl(input.url)}". Tried: ${errors.join('; ')}`,
      );
    },
  };
}
