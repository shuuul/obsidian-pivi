import type { WebProviderId, WebSearchToolsSettings } from '@pivi/agent/settings/types';

export interface SettingsWebProviderSnapshot {
  readonly id: WebProviderId;
  readonly search: boolean;
  readonly fetch: boolean;
  readonly apiKeyRequired: boolean;
  readonly credentialConfigured: boolean;
  readonly environmentCredential: boolean;
  readonly storedCredential: boolean;
}

export interface SettingsWebSearchPort {
  getSettings(): WebSearchToolsSettings;
  listProviders(): readonly SettingsWebProviderSnapshot[];
  saveSettings(patch: Partial<WebSearchToolsSettings>): Promise<void>;
  writeCredential(providerId: WebProviderId, key: string): void;
  clearCredential(providerId: WebProviderId): void;
}
