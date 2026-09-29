import type { ProviderOAuthProgress } from '@pivi/agent/auth/providerOAuthProgress';
import type { CustomProviderThinkingFormat } from '@pivi/agent/settings/customProviders';
import type { ModelCatalogRefreshResult } from '@pivi/agent/settings/modelCatalog';
import type { PiAgentSettingsView } from '@pivi/agent/settings/modelKey';
import type { AppModelReadinessStatusKind } from '@pivi/agent/settings/modelReadiness';

export type { ProviderOAuthProgress } from '@pivi/agent/auth/providerOAuthProgress';

/** Stored credential kind for a provider, or null when none is present. */
export type ModelsCredentialKind = 'api_key' | 'oauth';

/** Environment variable names backing a provider's credentials. */
export interface ModelsProviderEnvInfo {
  readonly apiKeyVar: string;
  readonly oauthVar?: string;
}

/** An addable built-in cloud provider option for the add-provider picker. */
export interface ModelsAddableProvider {
  readonly id: string;
  readonly name: string;
  readonly logoSlug: string | null;
}

/** An addable custom/local provider kind option for the add-provider picker. */
export interface ModelsAddableKind {
  readonly kind: string;
  readonly name: string;
  readonly logoSlug: string | null;
}

/** Secure-storage readiness reported by the models port bootstrap step. */
export interface ModelsBootstrapInfo {
  readonly secureStorageAvailable: boolean;
  readonly minimumHostVersion: string;
}

export interface SettingsModelsPort {
  /** Provider id for the OpenAI Codex OAuth provider. */
  readonly codexProviderId: string;
  /** Account/subscription providers that expose interactive OAuth in settings. */
  readonly interactiveOAuthProviderIds: readonly string[];
  /** Run stored-credential migration once and report secure-storage availability. */
  bootstrap(): ModelsBootstrapInfo;
  getSettings(): PiAgentSettingsView;
  saveSettings(patch: Partial<Pick<PiAgentSettingsView, 'addedProviders' | 'disabledProviders' | 'customProviders' | 'visibleModels'>>): Promise<void>;
  getProviderDisplayName(providerId: string): string;
  getProviderLogoSlug(providerId: string): string | null;
  getReadiness(providerId: string): AppModelReadinessStatusKind;
  getCredentialKind(providerId: string): ModelsCredentialKind | null;
  getProviderEnvInfo(providerId: string): ModelsProviderEnvInfo;
  getSecretId(providerId: string): string;
  setApiKey(providerId: string, key: string): Promise<void>;
  setOauthToken(providerId: string, token: string): Promise<void>;
  clearCredential(providerId: string): Promise<void>;
  hasProviderOAuth(providerId: string): boolean;
  loginProviderOAuth(providerId: string, onProgress?: (progress: ProviderOAuthProgress) => void): Promise<void>;
  cancelProviderOAuthLogin(providerId: string): void;
  logoutProviderOAuth(providerId: string): Promise<void>;
  listAddableBuiltinProviders(): readonly ModelsAddableProvider[];
  listAddableLocalKinds(): readonly ModelsAddableKind[];
  listCustomKinds(): readonly ModelsAddableKind[];
  addBuiltinProvider(providerId: string): Promise<void>;
  /** Add a custom/local provider kind and return the new provider id. */
  addCustomKind(kind: string): Promise<string>;
  removeProvider(providerId: string, deleteCredential: boolean): Promise<void>;
  /**
   * Rename a custom provider id and migrate model keys, credentials, and
   * header secrets. Returns the applied id.
   */
  renameCustomProvider(providerId: string, newId: string): Promise<string>;
  /** Refresh interactive OAuth credentials before readiness badges render. */
  ensureProviderCredentials(): Promise<void>;
  testProvider(providerId: string): Promise<{ ok: boolean; detail: string }>;
  patchCustomProvider(providerId: string, patch: { name?: string; baseUrl?: string }): Promise<void>;
  /** Patch user-authored fields of one fetched custom-provider model row. */
  patchCustomProviderModel(
    providerId: string,
    modelId: string,
    patch: {
      catalogModelId?: string;
      maxTokensOverride?: number | null;
      reasoningOverride?: boolean | null;
      thinkingFormatOverride?: CustomProviderThinkingFormat | null;
    },
  ): Promise<void>;
  getContextWindowOverride(modelKey: string): number | null;
  patchContextWindowOverride(modelKey: string, value: number | null): Promise<void>;
  fetchCustomProviderModels(providerId: string): Promise<{ count: number }>;
  /** Replace a custom provider's stored model IDs without calling the list endpoint. */
  setCustomProviderModelIds(providerId: string, modelIds: readonly string[]): Promise<void>;
  /** Refresh one built-in provider's remote model catalog into the registry. */
  refreshProviderCatalog(providerId: string): Promise<ModelCatalogRefreshResult>;
}
