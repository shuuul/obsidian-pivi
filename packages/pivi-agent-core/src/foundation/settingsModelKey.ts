import type { CustomProviderConfig } from './customProviders';

/** Persisted pi-ai model/API configuration on the settings bag. */
export interface PersistedPiAgentSettings {
  addedProviders?: string[];
  disabledProviders?: string[];
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
  customProviders?: CustomProviderConfig[];
}

/** Runtime view of Pi agent settings (includes derived fields for the settings UI). */
export interface PiAgentSettingsView extends PersistedPiAgentSettings {
  addedProviders: string[];
  disabledProviders: string[];
  customProviders: CustomProviderConfig[];
  availableModes: string[];
  discoveredModels: string[];
}

export function isValidModelKey(key: string): boolean {
  const slashIndex = key.indexOf('/');
  return slashIndex > 0 && slashIndex < key.length - 1;
}
