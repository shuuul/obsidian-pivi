import type { AgentRuntimeSettings, PiviSettings } from './settings';

/** Synced agent settings omit device-local provider, model, and environment fields. */
export type PersistedAgentRuntimeSettings = Omit<
  AgentRuntimeSettings,
  | 'addedProviders'
  | 'disabledProviders'
  | 'customProviders'
  | 'visibleModels'
  | 'lastModel'
  | 'webSearchTools'
  | 'environmentVariables'
>;

/**
 * Vault-synced settings shape without provider registry, model selection,
 * web provider order, custom-provider context-limit entries, or environment values.
 */
export type PersistedPiviSettings = Omit<
  PiviSettings,
  | 'model'
  | 'titleGenerationModel'
  | 'customContextLimits'
  | 'agentSettings'
  | 'sharedEnvironmentVariables'
> & {
  customContextLimits: Record<string, number>;
  agentSettings: PersistedAgentRuntimeSettings;
};
