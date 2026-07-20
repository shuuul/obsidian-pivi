import type { AgentRuntimeSettings, PiviSettings } from './settings';

/** Synced agent settings omit device-local provider and model fields. */
export type PersistedAgentRuntimeSettings = Omit<
  AgentRuntimeSettings,
  | 'addedProviders'
  | 'disabledProviders'
  | 'customProviders'
  | 'visibleModels'
  | 'lastModel'
  | 'webSearchTools'
>;

/**
 * Vault-synced settings shape without provider registry, model selection,
 * web provider order, or custom-provider context-limit entries.
 */
export type PersistedPiviSettings = Omit<
  PiviSettings,
  'model' | 'titleGenerationModel' | 'customContextLimits' | 'agentSettings'
> & {
  customContextLimits: Record<string, number>;
  agentSettings: PersistedAgentRuntimeSettings;
};
