import type { PiAgentSettings } from '../types/settings';

/** Default pi-ai environment string for fresh installs. */
export const PI_DEFAULT_ENVIRONMENT_VARIABLES = 'PI_ENABLE_EXA=1';

/** Primary model key for new vaults (`ObsiusSettings.model` and `agentSettings.visibleModels`). */
export const DEFAULT_MODEL_KEY = 'opencode-go/deepseek-v4-flash';

/** Providers Obsius exposes by default on fresh installs. */
export const DEFAULT_PI_PROVIDER_IDS = ['opencode-go', 'deepseek', 'openai-codex'] as const;

/** Persisted agent defaults when `agentSettings` is missing or repaired on load. */
export const DEFAULT_PI_AGENT_SETTINGS: Readonly<
  Pick<PiAgentSettings, 'addedProviders' | 'environmentVariables' | 'selectedMode' | 'visibleModels'>
> = Object.freeze({
  addedProviders: [...DEFAULT_PI_PROVIDER_IDS],
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: 'default',
  visibleModels: [DEFAULT_MODEL_KEY],
});

/** Active runtime defaults used by app-level settings initialization. */
export const DEFAULT_AGENT_SETTINGS = DEFAULT_PI_AGENT_SETTINGS;
