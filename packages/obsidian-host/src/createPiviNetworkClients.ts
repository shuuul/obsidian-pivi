import {
  type EgressPolicyOptions,
  type NetworkPurpose,
  OriginGrantRegistry,
} from '@pivi/pivi-agent-core/network';
import type { FetchCompatible, HttpClient } from '@pivi/pivi-agent-core/ports';

import { createScopedFetch, createScopedHttpClient } from './scopedHttpClient';

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
}

let activeNetworkClients: PiviNetworkClients | null = null;

/** Composition-installed network clients for app helpers that cannot receive DI directly. */
export function getActivePiviNetworkClients(): PiviNetworkClients {
  if (!activeNetworkClients) {
    throw new Error('Pivi network clients are not installed yet.');
  }
  return activeNetworkClients;
}

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

export function createPiviNetworkClients(
  grants: OriginGrantRegistry = new OriginGrantRegistry(),
): PiviNetworkClients {
  const providerFetch = createScopedFetch({
    policy: policyFor('provider', {
      allowedContentTypes: undefined,
      byteLimits: {
        maxEncodedResponseBytes: 32 * 1024 * 1024,
        maxDecodedResponseBytes: 32 * 1024 * 1024,
      },
      deadlines: {
        totalMs: 600_000,
        idleMs: 120_000,
      },
    }),
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
  };
  activeNetworkClients = clients;
  return clients;
}
