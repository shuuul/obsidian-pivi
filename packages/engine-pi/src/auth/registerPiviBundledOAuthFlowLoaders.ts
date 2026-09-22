import { anthropicOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/anthropic.js';
import { githubCopilotOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/github-copilot.js';
import { kimiCodingOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/kimi-coding.js';
import { registerBundledOAuthFlowLoaders } from '@earendil-works/pi-ai/dist/auth/oauth/load.js';
// pi-ai 0.87.0 requires a complete bundled-loader map; meta joined the
// upstream registry alongside anthropic/github-copilot/kimi-coding.
import { metaOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/meta.js';
import { openaiCodexOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js';
import { createRadiusOAuth } from '@earendil-works/pi-ai/dist/auth/oauth/radius.js';

import { createPiviOpenRouterOAuth } from './piviOpenRouterOAuth';
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
    openrouter: () => createPiviOpenRouterOAuth(request),
    kimiCoding: () => kimiCodingOAuth,
    meta: () => metaOAuth,
    xai: () => createPiviXaiOAuth(request),
    radius: createRadiusOAuth,
  });
}
