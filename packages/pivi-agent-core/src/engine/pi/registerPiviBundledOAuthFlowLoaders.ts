import { anthropicOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/anthropic.js';
import { githubCopilotOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/github-copilot.js';
import { registerBundledOAuthFlowLoaders } from '@earendil-works/pi-ai/dist/auth/oauth/load.js';
import { openaiCodexOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js';
import { createRadiusOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/radius.js';

import {
  createPiviXaiOAuth,
  type ProviderOAuthFetch,
} from './piviXaiOAuthDeviceFlow';

/** Register bundled pi-ai OAuth flows with the Pivi xAI device-flow shim. */
export function registerPiviBundledOAuthFlowLoaders(request: ProviderOAuthFetch): void {
  registerBundledOAuthFlowLoaders({
    anthropic: () => anthropicOAuth,
    openaiCodex: () => openaiCodexOAuth,
    githubCopilot: () => githubCopilotOAuth,
    xai: () => createPiviXaiOAuth(request),
    radius: createRadiusOAuth,
  });
}
