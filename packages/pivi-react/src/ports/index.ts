import type { ProviderOAuthProgress } from '@pivi/agent/auth/providerOAuthProgress';
import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpTestResult,
  McpTool,
} from '@pivi/agent/mcp/types';
import type { ChatUIOption } from '@pivi/agent/runtime/chatUi';
import type { PiviSettings } from '@pivi/agent/settings';
import type { CustomProviderThinkingFormat } from '@pivi/agent/settings/customProviders';
import type { PiAgentSettingsView } from '@pivi/agent/settings/modelKey';
import type { AppModelReadinessStatusKind } from '@pivi/agent/settings/modelReadiness';
import type {
  EditorSelectionToolbarSettings,
  EnvironmentScope,
  WebProviderId,
  WebSearchToolsSettings,
} from '@pivi/agent/settings/types';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';

import type {
  SettingsGeneralSnapshot,
  SettingsHotkeyRow,
  SettingsSubagentsSnapshot,
  SettingsUiSnapshotData,
} from '../settings/types';

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

export interface SettingsWebProviderSnapshot {
  readonly id: WebProviderId;
  readonly search: boolean;
  readonly fetch: boolean;
  readonly apiKeyRequired: boolean;
  readonly credentialConfigured: boolean;
  readonly environmentCredential: boolean;
  readonly storedCredential: boolean;
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
}

export type SettingsFeedbackKind = 'success' | 'error' | 'pending';

export interface SettingsFeedbackMessage {
  readonly kind: SettingsFeedbackKind;
  readonly message: string;
}

/** Host-neutral channel for timely settings feedback; Obsidian maps it to Notice. */
export interface SettingsFeedbackPort {
  notify(message: string): void;
}

export interface SettingsComplexPorts {
  models: SettingsModelsPort;
  skills: {
    featuredBundle: {
      getDescriptor(): {
        readonly name: string;
        readonly description: string;
        readonly source: string;
        readonly sourceUrl: string;
      };
      isInstalled(): boolean;
      install(): Promise<void>;
      update(): Promise<void>;
    };
    list(): readonly { name: string; description: string; folderName: string; disabled: boolean }[];
    listRemote(source: string): Promise<readonly { name: string; description: string }[]>;
    install(source: string, skillNames?: readonly string[]): Promise<void>;
    setDisabled(folderName: string, disabled: boolean): Promise<void>;
    remove(folderName: string): Promise<void>;
    updateAll(): Promise<void>;
    update(skillName: string, folderName: string): Promise<void>;
  };
  tools: {
    getSettings(): { allowBash: boolean; bashAllowlist: readonly string[]; allowExternalRead: boolean; externalReadDirectories: readonly string[] };
    listToolRows(): readonly SettingsToolRow[];
    setToolEnabled(name: string, enabled: boolean): Promise<void>;
    chooseExternalDirectory(current?: string): Promise<string | null>;
    validateExternalDirectory(path: string): Promise<{ valid: boolean; error?: string }>;
    saveSettings(patch: { allowBash?: boolean; bashAllowlist?: readonly string[]; allowExternalRead?: boolean; externalReadDirectories?: readonly string[] }): Promise<void>;
  };
  webSearch: {
    getSettings(): WebSearchToolsSettings;
    listProviders(): readonly SettingsWebProviderSnapshot[];
    saveSettings(patch: Partial<WebSearchToolsSettings>): Promise<void>;
    writeCredential(providerId: WebProviderId, key: string): void;
    clearCredential(providerId: WebProviderId): void;
  };
  runtime: {
    refreshPrompt(): Promise<void>;
    refreshModelSelectors(): void;
  };
  commands: {
    refresh(): Promise<void>;
    listIconNames(): readonly string[];
    loadWorkspaceCatalog(): Promise<{
      readonly entries: readonly SlashCatalogEntry[];
      readonly catalogRevision: number;
    }>;
    listDropdownEntries(): Promise<readonly SlashCatalogEntry[]>;
    saveWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<SlashCatalogEntry>;
    renameWorkspaceEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, catalogRevision: number): Promise<SlashCatalogEntry>;
    saveWorkspaceOrder(ids: readonly string[], catalogRevision: number): Promise<void>;
    deleteWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<{
      saved: true;
      refreshed: boolean;
      warnings?: string[];
    }>;
  };
  mcp: {
    load(): Promise<readonly ManagedMcpServer[]>;
    /** Cached tools currently known for one server; never opens a connection. */
    listTools(serverName: string): Promise<readonly McpTool[]>;
    save(servers: readonly ManagedMcpServer[]): Promise<void>;
    /** Authenticate when needed, fetch the tool inventory, and update the shared cache. */
    connect(server: ManagedMcpServer): Promise<{
      readonly authStatus: McpAuthStatus | null;
      readonly result: McpTestResult;
    }>;
    /** Null when workspace-scoped MCP OAuth is unavailable. */
    getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus | null>;
    /** Clear stored OAuth credentials and reconnect active MCP consumers. */
    logout(serverName: string): Promise<void>;
  };
}

export interface SettingsSnapshotPort {
  getSnapshot(): SettingsUiSnapshotData;
}

export interface SettingsActionsPort {
  saveGeneral(patch: Partial<SettingsGeneralSnapshot>): Promise<void>;
  saveSubagents(patch: Partial<SettingsSubagentsSnapshot>): Promise<void>;
  saveEditorSelectionToolbar(settings: EditorSelectionToolbarSettings): Promise<void>;
  purgeDeletedSessionFiles(): Promise<number>;
}

export interface SettingsToolRow {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly group: 'workspace-api' | 'host-cli' | 'pivi' | 'additional';
  readonly enabled: boolean;
  readonly available: boolean;
}

export interface SettingsHostIntegrationAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface SettingsHostIntegrationSection {
  readonly id: string;
  readonly heading: string;
  readonly description: string;
  readonly actions: readonly SettingsHostIntegrationAction[];
}

/** Host-owned integrations rendered by the product settings shell. */
export interface SettingsHostIntegrationsPort {
  listSections(): readonly SettingsHostIntegrationSection[] | Promise<readonly SettingsHostIntegrationSection[]>;
  runAction(actionId: string): Promise<{ readonly feedback?: SettingsFeedbackMessage }>;
}

/** Persistence helpers for complex settings pages that still project full settings snapshots. */
export interface SettingsPersistencePort {
  getSettingsSnapshot(): PiviSettings;
  commitSettingsSnapshot(snapshot: PiviSettings): Promise<void>;
}

export interface SettingsEnvironmentEntryView {
  readonly key: string;
  readonly scope: EnvironmentScope;
  readonly sourceKind: 'plain' | 'secret' | 'systemEnvironment';
  readonly plainValue?: string;
  readonly systemName?: string;
  readonly storageLocation: 'deviceLocal' | 'secureStorage' | 'systemEnvironment';
  readonly hasStoredSecret: boolean;
}

export interface SettingsEnvironmentPort {
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariables(scope: EnvironmentScope): string;
  listEntries(scope?: EnvironmentScope): readonly SettingsEnvironmentEntryView[];
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  importEnvironmentText(scope: EnvironmentScope, envText: string): Promise<void>;
  getReviewKeys(scope: EnvironmentScope, envText: string): readonly string[];
}

export interface SettingsHotkeysPort {
  listHotkeys(): readonly SettingsHotkeyRow[];
  openHotkeySettings(): void;
}

export interface SettingsEditorToolbarCommandEntry {
  readonly id: string;
  readonly name: string;
  /** Host icon id when the command declares one. */
  readonly iconId?: string;
}

export interface SettingsEditorToolbarPiviCommandEntry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  /** Catalog icon id when the command declares one. */
  readonly icon?: string;
}

export interface SettingsEditorToolbarPort {
  listHostCommands(): readonly SettingsEditorToolbarCommandEntry[];
  listPiviCommands(): Promise<readonly SettingsEditorToolbarPiviCommandEntry[]>;
  listIconNames(): readonly string[];
  /** True when Note Toolbar's selected-text toolbar is active and Pivi's toolbar auto-yields. */
  isNoteToolbarTextToolbarActive(): boolean;
}

export interface SettingsCatalogPort {
  listModelsForProvider(providerId: string): ChatUIOption[];
  listCatalogModels(): ChatUIOption[];
  syncCustomProviders(snapshot: PiviSettings): void;
  fetchCustomProviderModels(
    providerId: string,
    snapshot: PiviSettings,
  ): Promise<{ count: number }>;
}

/** Handle returned by the mention prompt editor port after mounting. */
export interface SettingsMentionEditorHandle {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

export interface SettingsMentionEditorCallbacks {
  onChange?(text: string): void;
}

/**
 * Mounts an imperative mention-capable prompt editor (`@` vault files/folders/
 * agents, `/` skills/MCP/tools/commands) into a React-owned empty container.
 * The persisted value is canonical plain text identical to composer-extracted
 * text; badges are editing-time presentation only.
 */
export interface SettingsMentionEditorPort {
  mount(
    container: HTMLElement,
    initialValue: string,
    callbacks: SettingsMentionEditorCallbacks,
  ): SettingsMentionEditorHandle;
}

export interface SettingsAboutSnapshot {
  readonly version: string;
  readonly releasedAt: string;
  readonly githubUrl: string;
  readonly issuesUrl: string;
}

export interface SettingsAboutPort {
  getSnapshot(): SettingsAboutSnapshot;
}

export type SettingsPromptModuleKind = 'core' | 'workflow' | 'custom';

export type SettingsPromptUsageSectionId = 'core' | 'workflow' | 'custom' | 'tools' | 'mcp';

export interface SettingsPromptModuleView {
  readonly id: string;
  readonly kind: SettingsPromptModuleKind;
  readonly title: string;
  readonly enabled: boolean;
  readonly modified: boolean;
  readonly body: string;
}

export interface SettingsPromptUsageSection {
  readonly id: SettingsPromptUsageSectionId;
  readonly estimatedTokens: number;
}

export interface SettingsPromptUsageSnapshot {
  readonly sections: readonly SettingsPromptUsageSection[];
  readonly totalEstimatedTokens: number;
}

export interface SettingsPromptCreateInput {
  readonly title?: string;
  readonly body?: string;
  readonly enabled?: boolean;
}

export interface SettingsPromptPort {
  getCatalogRevision(): number;
  listModules(): readonly SettingsPromptModuleView[];
  getUsage(): SettingsPromptUsageSnapshot;
  setWorkflowEnabled(id: string, enabled: boolean, catalogRevision: number): Promise<void>;
  saveCustomBody(id: string, customBody: string, catalogRevision: number): Promise<void>;
  restoreShipped(id: string, catalogRevision: number): Promise<void>;
  createCustomModule(input: SettingsPromptCreateInput | undefined, catalogRevision: number): Promise<SettingsPromptModuleView>;
  renameCustomModule(id: string, title: string, catalogRevision: number): Promise<void>;
  editCustomModule(id: string, body: string, catalogRevision: number): Promise<void>;
  reorderCustomModules(ids: readonly string[], catalogRevision: number): Promise<void>;
  setCustomModuleEnabled(id: string, enabled: boolean, catalogRevision: number): Promise<void>;
  deleteCustomModule(id: string, catalogRevision: number): Promise<void>;
}

export interface SettingsPorts {
  feedback: SettingsFeedbackPort;
  snapshot: SettingsSnapshotPort;
  actions: SettingsActionsPort;
  complex: SettingsComplexPorts;
  persistence: SettingsPersistencePort;
  environment: SettingsEnvironmentPort;
  hotkeys: SettingsHotkeysPort;
  editorToolbar: SettingsEditorToolbarPort;
  catalog: SettingsCatalogPort;
  hostIntegrations: SettingsHostIntegrationsPort;
  mentionEditor: SettingsMentionEditorPort;
  about: SettingsAboutPort;
  prompt: SettingsPromptPort;
}
