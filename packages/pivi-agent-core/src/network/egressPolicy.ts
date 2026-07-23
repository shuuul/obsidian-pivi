/**
 * Destination policy, DNS pinning helpers, redirect header rules, and
 * short-lived origin grants for local/private network exceptions.
 */

import { isSecretLikeHeaderName } from '../foundation/configValueSource';
import {
  canonicalizeIpAddress,
  classifyIpLiteral,
  type IpDestinationClass,
  isDeniedIpClass,
  isLiteralIpHostname,
} from './ipClassification';
import {
  isCrossOrigin,
  isSchemeDowngrade,
  normalizeHttpUrl,
  redactUrl,
  resolveRedirectUrl,
  urlOriginKey,
} from './urlPolicy';

export type NetworkPurpose =
  | 'provider'
  | 'mcp'
  | 'oauth'
  | 'web-search'
  | 'web-fetch'
  | 'image'
  | 'skills'
  | 'connectivity'
  | 'generic';

export interface EgressDeadlines {
  connectMs: number;
  firstByteMs: number;
  idleMs: number;
  totalMs: number;
}

export interface EgressByteLimits {
  maxRequestBytes: number;
  maxEncodedResponseBytes: number;
  maxDecodedResponseBytes: number;
}

export interface EgressPolicyOptions {
  purpose: NetworkPurpose;
  /** When false (default), private/loopback/metadata destinations are denied unless granted. */
  allowPrivateNetwork?: boolean;
  /** Deny https→http redirects (default true). */
  denySchemeDowngrade?: boolean;
  maxRedirects?: number;
  deadlines?: Partial<EgressDeadlines>;
  byteLimits?: Partial<EgressByteLimits>;
  /** When set, response Content-Type must match one of these prefixes/exact values. */
  allowedContentTypes?: readonly string[];
  /** Optional abort signal merged with deadline controllers. */
  signal?: AbortSignal;
}

export interface ResolvedEgressPolicy {
  purpose: NetworkPurpose;
  allowPrivateNetwork: boolean;
  denySchemeDowngrade: boolean;
  maxRedirects: number;
  deadlines: EgressDeadlines;
  byteLimits: EgressByteLimits;
  allowedContentTypes: readonly string[] | null;
  signal?: AbortSignal;
}

export const DEFAULT_EGRESS_DEADLINES: Readonly<EgressDeadlines> = Object.freeze({
  connectMs: 10_000,
  firstByteMs: 20_000,
  idleMs: 30_000,
  totalMs: 120_000,
});

export const DEFAULT_EGRESS_BYTE_LIMITS: Readonly<EgressByteLimits> = Object.freeze({
  maxRequestBytes: 2 * 1024 * 1024,
  maxEncodedResponseBytes: 8 * 1024 * 1024,
  maxDecodedResponseBytes: 8 * 1024 * 1024,
});

export function resolveEgressPolicy(options: EgressPolicyOptions): ResolvedEgressPolicy {
  return {
    purpose: options.purpose,
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    denySchemeDowngrade: options.denySchemeDowngrade !== false,
    maxRedirects: Math.max(0, Math.min(options.maxRedirects ?? 5, 20)),
    deadlines: {
      ...DEFAULT_EGRESS_DEADLINES,
      ...options.deadlines,
    },
    byteLimits: {
      ...DEFAULT_EGRESS_BYTE_LIMITS,
      ...options.byteLimits,
    },
    allowedContentTypes: options.allowedContentTypes
      ? [...options.allowedContentTypes]
      : null,
    signal: options.signal,
  };
}

export class EgressDeniedError extends Error {
  readonly code = 'egress-denied' as const;
  readonly classification: IpDestinationClass;
  readonly redactedUrl: string;

  constructor(classification: IpDestinationClass, url: URL | string, detail?: string) {
    const redacted = redactUrl(url);
    super(detail ?? `Network destination denied (${classification}): ${redacted}`);
    this.name = 'EgressDeniedError';
    this.classification = classification;
    this.redactedUrl = redacted;
  }
}

export class EgressPolicyError extends Error {
  readonly code:
    | 'redirect-limit'
    | 'scheme-downgrade'
    | 'dns'
    | 'pin-mismatch'
    | 'content-type'
    | 'byte-limit'
    | 'deadline'
    | 'aborted';

  constructor(code: EgressPolicyError['code'], message: string) {
    super(message);
    this.name = 'EgressPolicyError';
    this.code = code;
  }
}

export type DnsLookupFn = (hostname: string) => Promise<readonly string[]>;

export interface OriginGrant {
  origin: string;
  /** Exclusive expiry timestamp (ms since epoch). */
  expiresAt: number;
  purpose?: NetworkPurpose;
}

/** Turn-scoped / short-lived grants for otherwise-denied private origins. */
export class OriginGrantRegistry {
  private readonly grants = new Map<string, OriginGrant>();

  grant(originOrUrl: string | URL, ttlMs: number, purpose?: NetworkPurpose, now = Date.now()): OriginGrant {
    const url = typeof originOrUrl === 'string' && !originOrUrl.includes('://')
      ? null
      : normalizeHttpUrl(typeof originOrUrl === 'string' ? originOrUrl : originOrUrl);
    const origin = url ? urlOriginKey(url) : originOrUrl.toString().toLowerCase();
    const grant: OriginGrant = {
      origin,
      expiresAt: now + Math.max(0, ttlMs),
      purpose,
    };
    this.grants.set(origin, grant);
    return grant;
  }

  revoke(originOrUrl: string | URL): void {
    const origin = typeof originOrUrl === 'string' && !originOrUrl.includes('://')
      ? originOrUrl.toLowerCase()
      : urlOriginKey(normalizeHttpUrl(typeof originOrUrl === 'string' ? originOrUrl : originOrUrl));
    this.grants.delete(origin);
  }

  clear(): void {
    this.grants.clear();
  }

  /** Remove all grants scoped to one purpose without touching other purposes. */
  revokeByPurpose(purpose: NetworkPurpose): void {
    for (const [origin, grant] of this.grants) {
      if (grant.purpose === purpose) {
        this.grants.delete(origin);
      }
    }
  }

  has(originOrUrl: string | URL, purpose?: NetworkPurpose, now = Date.now()): boolean {
    const origin = typeof originOrUrl === 'string' && !originOrUrl.includes('://')
      ? originOrUrl.toLowerCase()
      : urlOriginKey(normalizeHttpUrl(typeof originOrUrl === 'string' ? originOrUrl : originOrUrl));
    const grant = this.grants.get(origin);
    if (!grant) {
      return false;
    }
    if (grant.expiresAt <= now) {
      this.grants.delete(origin);
      return false;
    }
    if (purpose && grant.purpose && grant.purpose !== purpose) {
      return false;
    }
    return true;
  }
}

export function classifyHostnameOrAddress(hostname: string): IpDestinationClass {
  if (hostname.toLowerCase() === 'localhost') {
    return 'loopback';
  }
  if (!isLiteralIpHostname(hostname) && hostname !== 'localhost') {
    // Domain names are checked after DNS resolution.
    return 'public';
  }
  return classifyIpLiteral(hostname);
}

/**
 * TTL for configured private-origin grants. Spans a normal plugin session so
 * local providers (Ollama, LM Studio, LAN endpoints) keep working across long
 * uptimes without per-request re-grants. Grants are cleared on workspace dispose.
 */
export const PRIVATE_ORIGIN_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Grant only the private/loopback origins among `urls` for `purpose`. Public
 * domains are left to DNS-time egress checks; malformed entries are ignored so
 * validation can surface them through its own path. Callers that re-derive the
 * full origin set should `revokeByPurpose(purpose)` first so removed origins
 * drop out.
 */
export function grantPrivateOrigins(
  grants: OriginGrantRegistry,
  urls: readonly (string | null | undefined)[],
  purpose: NetworkPurpose,
  ttlMs: number = PRIVATE_ORIGIN_GRANT_TTL_MS,
): void {
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const url = normalizeHttpUrl(raw);
      if (isDeniedIpClass(classifyHostnameOrAddress(url.hostname))) {
        grants.grant(url, ttlMs, purpose);
      }
    } catch {
      // Ignore malformed configured URLs; validation surfaces elsewhere.
    }
  }
}

export function assertDestinationAllowed(
  url: URL,
  resolvedAddresses: readonly string[],
  policy: ResolvedEgressPolicy,
  grants?: OriginGrantRegistry,
): void {
  const originGranted = grants?.has(url, policy.purpose) === true;
  if (policy.allowPrivateNetwork || originGranted) {
    // Still reject multicast / unspecified / invalid even with grants.
    for (const address of resolvedAddresses) {
      const classification = classifyIpLiteral(address);
      if (
        classification === 'multicast'
        || classification === 'unspecified'
        || classification === 'invalid'
        || classification === 'cloud-metadata'
      ) {
        throw new EgressDeniedError(classification, url);
      }
    }
    return;
  }

  const hostClass = classifyHostnameOrAddress(url.hostname);
  if (isDeniedIpClass(hostClass) && hostClass !== 'public') {
    throw new EgressDeniedError(hostClass, url);
  }

  if (resolvedAddresses.length === 0) {
    throw new EgressPolicyError('dns', `DNS resolution returned no addresses for ${redactUrl(url)}`);
  }

  for (const address of resolvedAddresses) {
    const classification = classifyIpLiteral(address);
    if (isDeniedIpClass(classification)) {
      throw new EgressDeniedError(classification, url);
    }
  }
}

export function assertPinnedAddress(
  approvedAddresses: readonly string[],
  connectedAddress: string,
  url: URL,
): void {
  const connected = canonicalizeIpAddress(connectedAddress);
  if (!connected) {
    throw new EgressPolicyError('pin-mismatch', `Connected address is invalid for ${redactUrl(url)}`);
  }
  const approved = new Set(
    approvedAddresses
      .map((address) => canonicalizeIpAddress(address))
      .filter((address): address is string => Boolean(address)),
  );
  if (!approved.has(connected)) {
    throw new EgressPolicyError(
      'pin-mismatch',
      `Connected address was not in the approved DNS set for ${redactUrl(url)}`,
    );
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/** Strip hop-by-hop and sensitive headers on cross-origin redirects. */
export function filterRedirectHeaders(
  headers: Headers,
  from: URL,
  to: URL,
): Headers {
  const next = new Headers(headers);
  const crossOrigin = isCrossOrigin(from, to);
  const names: string[] = [];
  next.forEach((_value, key) => {
    names.push(key);
  });
  for (const name of names) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      next.delete(name);
      continue;
    }
    if (crossOrigin && isSecretLikeHeaderName(name)) {
      next.delete(name);
    }
  }
  return next;
}

export function prepareRedirect(
  current: URL,
  locationHeader: string,
  redirectCount: number,
  policy: ResolvedEgressPolicy,
): URL {
  if (redirectCount >= policy.maxRedirects) {
    throw new EgressPolicyError(
      'redirect-limit',
      `Exceeded maximum redirects (${policy.maxRedirects}) for ${redactUrl(current)}`,
    );
  }
  const next = resolveRedirectUrl(current, locationHeader);
  if (policy.denySchemeDowngrade && isSchemeDowngrade(current, next)) {
    throw new EgressPolicyError(
      'scheme-downgrade',
      `Refusing HTTPS to HTTP redirect for ${redactUrl(current)}`,
    );
  }
  return next;
}

export function contentTypeAllowed(
  contentType: string | null,
  allowed: readonly string[] | null,
): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  if (!contentType) {
    return false;
  }
  const base = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return allowed.some((candidate) => {
    const normalized = candidate.trim().toLowerCase();
    if (normalized.endsWith('/*')) {
      const prefix = normalized.slice(0, -1);
      return base.startsWith(prefix);
    }
    return base === normalized;
  });
}

export {
  canonicalizeIpAddress,
  classifyIpLiteral,
  type IpDestinationClass,
  isDeniedIpClass,
  isLiteralIpHostname,
} from './ipClassification';
export {
  isCrossOrigin,
  isSchemeDowngrade,
  NetworkUrlError,
  normalizeHttpUrl,
  redactUrl,
  resolveRedirectUrl,
  urlOriginKey,
} from './urlPolicy';
