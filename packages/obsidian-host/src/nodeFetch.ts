/**
 * Compatibility surface formerly used as a global renderer fetch replacement.
 * Prefer createScopedFetch / createPiviNetworkClients. This module no longer
 * assigns window.fetch.
 */

import type { FetchCompatible } from '@pivi/pivi-agent-core/ports';

import { applyScopedHttpDefaultHeaders, createScopedFetch } from './scopedHttpClient';

export { applyScopedHttpDefaultHeaders as applyNodeFetchDefaultHeaders };

/** Unscoped Node fetch used only by focused legacy tests; production composition uses purpose policies. */
export function createNodeFetch(): FetchCompatible {
  return createScopedFetch({
    policy: {
      purpose: 'generic',
      // Legacy helper defaults to denying private destinations.
      allowPrivateNetwork: false,
    },
  });
}

export const nodeFetch = createNodeFetch();
