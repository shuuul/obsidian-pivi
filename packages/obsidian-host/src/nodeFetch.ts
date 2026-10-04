/**
 * Compatibility surface formerly used as a global renderer fetch replacement.
 * Prefer createScopedFetch / createPiviNetworkClients. This module no longer
 * assigns window.fetch.
 */

import { applyScopedHttpDefaultHeaders } from './scopedHttpClient';

export { applyScopedHttpDefaultHeaders as applyNodeFetchDefaultHeaders };

