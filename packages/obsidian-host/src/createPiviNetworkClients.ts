import {
  type EgressPolicyOptions,
  type NetworkPurpose,
  OriginGrantRegistry,
} from '@pivi/agent/network';
import type { FetchCompatible, HttpClient } from '@pivi/agent/ports';

import { createScopedFetch, createScopedHttpClient } from './scopedHttpClient';

export interface ProviderDeadlineUpdate {
  totalMs: number;
  idleMs: number;
}

export interface PiviNetworkClients {
  /** Shared turn/origin grant registry for local-network exceptions. */
  grants: OriginGrantRegistry;
  /** Provider / LLM / OAuth SDK fetch (also installed into the bundle inject). */
  providerFetch: FetchCompatible;
  mcpFetch: FetchCompatible;
  webSearchFetch: FetchCompatible;
  webFetch: FetchCompatible;
  imageFetch: FetchCompatible;
  skillsFetch: FetchCompatible;
  /** HttpClient adapter used by connectivity probes and custom-provider discovery. */
  httpClient: HttpClient;
  /** Local/custom provider discovery may need short-lived private-origin grants. */
  localProviderHttpClient: HttpClient;
  /**
   * Mutate live provider total/idle deadlines. Subsequent `providerFetch`
   * calls read the updated policy without recreating clients. `0` disables
   * that timer. Invalid values keep the current finite nonnegative integer.
   */
  setProviderDeadlines(deadlines: ProviderDeadlineUpdate): void;
}

let activeNetworkClients: PiviNetworkClients | null = null;

/** Composition-installed network clients for app helpers that cannot receive DI directly. */
export function getActivePiviNetworkClients(): PiviNetworkClients {
  if (!activeNetworkClients) {
    throw new Error('Pivi network clients are not installed yet.');
  }
  return activeNetworkClients;
}

const DEFAULT_PROVIDER_TOTAL_MS = 600_000;
const DEFAULT_PROVIDER_IDLE_MS = 120_000;

function policyFor(
  purpose: NetworkPurpose,
  overrides?: Partial<EgressPolicyOptions>,
): EgressPolicyOptions {
  return {
    purpose,
    allowPrivateNetwork: false,
    denySchemeDowngrade: true,
    maxRedirects: 5,
    ...overrides,
  };
}

function normalizeDeadlineMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function createPiviNetworkClients(
  grants: OriginGrantRegistry = new OriginGrantRegistry(),
): PiviNetworkClients {
  const providerDeadlines = {
    totalMs: DEFAULT_PROVIDER_TOTAL_MS,
    idleMs: DEFAULT_PROVIDER_IDLE_MS,
  };
  const providerPolicy = policyFor('provider', {
    allowedContentTypes: undefined,
    byteLimits: {
      maxEncodedResponseBytes: 32 * 1024 * 1024,
      maxDecodedResponseBytes: 32 * 1024 * 1024,
    },
    deadlines: providerDeadlines,
  });
  const providerFetch = createScopedFetch({
    policy: providerPolicy,
    grants,
  });

  const mcpFetch = createScopedFetch({
    policy: policyFor('mcp', {
      maxRedirects: 3,
      deadlines: { totalMs: 120_000 },
    }),
    grants,
  });

  const webSearchFetch = createScopedFetch({
    policy: policyFor('web-search', {
      allowedContentTypes: ['application/json', 'text/json', 'text/*'],
      byteLimits: {
        maxEncodedResponseBytes: 4 * 1024 * 1024,
        maxDecodedResponseBytes: 4 * 1024 * 1024,
      },
    }),
    grants,
  });

  const webFetch = createScopedFetch({
    policy: policyFor('web-fetch', {
      allowedContentTypes: [
        'text/html',
        'text/plain',
        'text/markdown',
        'text/xml',
        'application/xhtml+xml',
        'application/xml',
        'application/json',
        'text/*',
      ],
      byteLimits: {
        maxEncodedResponseBytes: 2 * 1024 * 1024,
        maxDecodedResponseBytes: 2 * 1024 * 1024,
      },
      maxRedirects: 5,
    }),
    grants,
  });

  const imageFetch = createScopedFetch({
    policy: policyFor('image', {
      deadlines: { totalMs: 300_000, idleMs: 120_000 },
      byteLimits: {
        maxEncodedResponseBytes: 16 * 1024 * 1024,
        maxDecodedResponseBytes: 16 * 1024 * 1024,
      },
    }),
    grants,
  });

  const skillsFetch = createScopedFetch({
    policy: policyFor('skills', {
      allowedContentTypes: ['application/json', 'text/*'],
    }),
    grants,
  });

  const httpClient = createScopedHttpClient({
    policy: policyFor('connectivity'),
    grants,
  });

  const localProviderHttpClient = createScopedHttpClient({
    policy: policyFor('provider', {
      allowPrivateNetwork: false,
    }),
    grants,
  });

  const clients: PiviNetworkClients = {
    grants,
    providerFetch,
    mcpFetch,
    webSearchFetch,
    webFetch,
    imageFetch,
    skillsFetch,
    httpClient,
    localProviderHttpClient,
    setProviderDeadlines({ totalMs, idleMs }) {
      providerDeadlines.totalMs = normalizeDeadlineMs(totalMs, providerDeadlines.totalMs);
      providerDeadlines.idleMs = normalizeDeadlineMs(idleMs, providerDeadlines.idleMs);
    },
  };
  activeNetworkClients = clients;
  return clients;
}
