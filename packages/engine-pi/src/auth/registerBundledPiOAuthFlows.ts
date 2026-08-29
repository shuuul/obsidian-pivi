import type { ProviderOAuthFetch } from './piviXaiOAuthDeviceFlow';
import { registerPiviBundledOAuthFlowLoaders } from './registerPiviBundledOAuthFlowLoaders';

/** Register pi-ai OAuth flows statically for Obsidian's bundled CJS runtime. */
export function registerBundledPiOAuthFlows(request: ProviderOAuthFetch): void {
  registerPiviBundledOAuthFlowLoaders(request);
}
