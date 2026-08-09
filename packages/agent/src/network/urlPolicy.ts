/**
 * HTTP(S) URL normalization, credential rejection, and diagnostic redaction.
 */

import { isSecretLikeKey } from '../foundation/configValueSource';

export class NetworkUrlError extends Error {
  readonly code: 'scheme' | 'credentials' | 'invalid' | 'empty';

  constructor(code: NetworkUrlError['code'], message: string) {
    super(message);
    this.name = 'NetworkUrlError';
    this.code = code;
  }
}

const SENSITIVE_QUERY_NAMES = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'auth',
  'authorization',
  'signature',
  'sig',
  'secret',
  'password',
  'passwd',
  'session',
  'sessionid',
  'code',
  'client_secret',
]);

function isSensitiveQueryName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (SENSITIVE_QUERY_NAMES.has(normalized)) {
    return true;
  }
  // Reuse secret-like header/key classification for query names.
  return isSecretLikeKey(normalized.replace(/-/g, '_'));
}

/** Parse and normalize an http(s) URL; reject credentials and other schemes. */
export function normalizeHttpUrl(raw: string | URL): URL {
  const text = typeof raw === 'string' ? raw.trim() : raw.toString();
  if (!text) {
    throw new NetworkUrlError('empty', 'URL is required');
  }

  let parsed: URL;
  try {
    parsed = typeof raw === 'string' ? new URL(text) : new URL(raw.toString());
  } catch {
    throw new NetworkUrlError('invalid', 'URL is not valid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NetworkUrlError('scheme', 'Only http: and https: URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new NetworkUrlError('credentials', 'URL username/password credentials are not allowed');
  }

  // Force IDNA / WHATWG hostname normalization via round-trip.
  const normalized = new URL(parsed.toString());
  normalized.hash = '';
  return normalized;
}

export function urlOriginKey(url: URL): string {
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/** Redact credentials and sensitive query values for logs, errors, and UI. */
export function redactUrl(raw: string | URL): string {
  let parsed: URL;
  try {
    parsed = typeof raw === 'string' ? new URL(raw) : new URL(raw.toString());
  } catch {
    return '[invalid-url]';
  }

  if (parsed.username || parsed.password) {
    parsed.username = parsed.username ? '***' : '';
    parsed.password = parsed.password ? '***' : '';
  }

  if (parsed.searchParams.size > 0) {
    const next = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      next.append(key, isSensitiveQueryName(key) ? '***' : value);
    });
    parsed.search = next.toString() ? `?${next.toString()}` : '';
  }

  return parsed.toString();
}

/** Resolve a redirect Location against the current request URL with policy checks. */
export function resolveRedirectUrl(current: URL, locationHeader: string): URL {
  const trimmed = locationHeader.trim();
  if (!trimmed) {
    throw new NetworkUrlError('invalid', 'Redirect location is empty');
  }
  let next: URL;
  try {
    next = new URL(trimmed, current);
  } catch {
    throw new NetworkUrlError('invalid', 'Redirect location is not a valid URL');
  }
  return normalizeHttpUrl(next);
}

/** True when https → http would be a scheme downgrade. */
export function isSchemeDowngrade(from: URL, to: URL): boolean {
  return from.protocol === 'https:' && to.protocol === 'http:';
}

/** Cross-origin check for sensitive-header stripping on redirects. */
export function isCrossOrigin(from: URL, to: URL): boolean {
  return urlOriginKey(from) !== urlOriginKey(to);
}
