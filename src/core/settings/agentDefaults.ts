import type { PiAgentSettings } from '../types/settings';

/** Default pi-ai environment string for fresh installs. */
export const PI_DEFAULT_ENVIRONMENT_VARIABLES = 'PI_ENABLE_EXA=1';

/** Primary model key for new vaults (`ObsiusSettings.model` and `agentSettings.visibleModels`). */
export const DEFAULT_MODEL_KEY = 'anthropic/claude-sonnet-4-20250514';

/** Persisted agent defaults when `agentSettings` is missing or repaired on load. */
export const DEFAULT_PI_AGENT_SETTINGS: Readonly<
  Pick<PiAgentSettings, 'addedProviders' | 'environmentVariables' | 'selectedMode' | 'visibleModels'>
> = Object.freeze({
  addedProviders: ['anthropic', 'openai', 'google', 'deepseek', 'openrouter'],
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: 'default',
  visibleModels: [DEFAULT_MODEL_KEY],
});
