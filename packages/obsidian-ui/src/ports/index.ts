import type {
  OpenSessionState,
  PiviSettings,
  SessionSummary,
} from '@pivi/pivi-agent-core/foundation';
import type { ChatUIOption } from '@pivi/pivi-agent-core/foundation/chatUi';
import type { EnvironmentScope } from '@pivi/pivi-agent-core/foundation/settings';
import type { PiAgentSettingsView } from '@pivi/pivi-agent-core/foundation/settingsModelKey';
import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpTestResult,
} from '@pivi/pivi-agent-core/mcp/types';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { LeafSummary } from '@pivi/pivi-agent-core/session';
import type {
  SlashCommandDropdownConfig,
} from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type {
  SlashCatalogEntry,
} from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

import type {
  NoteToolbarSetupResultSnapshot,
  SettingsGeneralSnapshot,
  SettingsHotkeyRow,
  SettingsSubagentsSnapshot,
  SettingsUiSnapshotData,
} from '../settings/types';

export interface ChatRuntimePort {
  createChatService(): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
}

export interface ChatSessionPort {
  listSessions(): SessionSummary[];
  getOpenSession(id: string): Promise<OpenSessionState | null>;
  createSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState>;
  openSessionFile(sessionFile: string, leafId?: string | null): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  listSessionLeaves(sessionFile: string): Promise<LeafSummary[]>;
  forkSession(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
}

export interface ChatCatalogPort {
  listMcpServers(): ManagedMcpServer[];
  listContextSavingMcpServers(): ManagedMcpServer[];
  listMcpTools(serverName: string): Promise<Array<{ name: string; description?: string }>>;
  listSkills(): Array<{ name: string; description?: string }>;
  listSlashEntries(includeBuiltIns: boolean): Promise<SlashCatalogEntry[]>;
  getSlashDropdownConfig(): SlashCommandDropdownConfig;
  refreshSlashCatalog(): Promise<void>;
}

/** Narrow model readiness surface for composer toolbar gating/testing. */
export interface ChatModelReadinessPort {
  getStatus(
    model: string,
    settings: Record<string, unknown>,
  ): {
    kind: ModelsProviderReadinessKind;
    label: string;
    description: string;
  };
  testModel(
    model: string,
    settings: Record<string, unknown>,
  ): Promise<{ ok: boolean; detail: string }>;
}

export interface ChatModelsPort {
  getReadinessProvider(): ChatModelReadinessPort | null;
}

/** Narrow chat feature ports: runtime factories, session CRUD, catalogs, and model readiness. */
export interface ChatPorts {
  runtime: ChatRuntimePort;
  sessions: ChatSessionPort;
  catalog: ChatCatalogPort;
  models: ChatModelsPort;
}

/** Provider readiness state derived by the app layer (mirrors ProviderReadinessStatusKind). */
export type ModelsProviderReadinessKind =
  | 'ready'
  | 'missing-credential'
  | 'oauth-expired'
  | 'disabled'
  | 'unavailable';

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

/** Keychain readiness reported by the models port bootstrap step. */
export interface ModelsBootstrapInfo {
  readonly keychainAvailable: boolean;
  readonly minKeychainVersion: string;
}

export interface SettingsModelsPort {
  /** Provider id for the OpenAI Codex OAuth provider. */
  readonly codexProviderId: string;
  /** Run keychain migration once and report keychain availability. */
  bootstrap(): ModelsBootstrapInfo;
  getSettings(): PiAgentSettingsView;
  saveSettings(patch: Partial<Pick<PiAgentSettingsView, 'addedProviders' | 'disabledProviders' | 'customProviders' | 'visibleModels'>>): Promise<void>;
  getProviderDisplayName(providerId: string): string;
  getProviderLogoSlug(providerId: string): string | null;
  getReadiness(providerId: string): ModelsProviderReadinessKind;
  getCredentialKind(providerId: string): ModelsCredentialKind | null;
  getProviderEnvInfo(providerId: string): ModelsProviderEnvInfo;
  getSecretId(providerId: string): string;
  setApiKey(providerId: string, key: string): Promise<void>;
  setOauthToken(providerId: string, token: string): Promise<void>;
  clearCredential(providerId: string): Promise<void>;
  hasCodexAuth(): boolean;
  loginCodex(onProgress?: (message: string) => void): Promise<void>;
  logoutCodex(): void;
  listAddableBuiltinProviders(): readonly ModelsAddableProvider[];
  listAddableLocalKinds(): readonly ModelsAddableKind[];
  listCustomKinds(): readonly ModelsAddableKind[];
  addBuiltinProvider(providerId: string): Promise<void>;
  /** Add a custom/local provider kind and return the new provider id. */
  addCustomKind(kind: string): Promise<string>;
  removeProvider(providerId: string): Promise<void>;
  testProvider(providerId: string): Promise<{ ok: boolean; detail: string }>;
  patchCustomProvider(providerId: string, patch: { name?: string; baseUrl?: string }): Promise<void>;
  fetchCustomProviderModels(providerId: string): Promise<{ count: number }>;
  /** Thin transient notice channel; app maps this to a host Notice. */
  notify(message: string): void;
}

export interface SettingsComplexPorts {
  models: SettingsModelsPort;
  skills: {
    list(): readonly { name: string; description: string; folderName: string; disabled: boolean }[];
    listRemote(source: string): Promise<readonly { name: string; description: string }[]>;
    install(source: string, skillNames?: readonly string[]): Promise<void>;
    setDisabled(folderName: string, disabled: boolean): Promise<void>;
    remove(folderName: string): Promise<void>;
    updateAll(): Promise<void>;
    update(skillName: string, folderName: string): Promise<void>;
  };
  tools: {
    getSettings(): { allowBash: boolean; bashAllowlist: readonly string[]; allowExternalRead: boolean; externalReadDirectories: readonly string[]; disabledTools: readonly string[]; officialCliEnabled: boolean };
    chooseExternalDirectory(current?: string): Promise<string | null>;
    validateExternalDirectory(path: string): Promise<{ valid: boolean; error?: string }>;
    saveSettings(patch: { allowBash?: boolean; bashAllowlist?: readonly string[]; allowExternalRead?: boolean; externalReadDirectories?: readonly string[]; disabledTools?: readonly string[] }): Promise<void>;
  };
  webSearch: {
    getSettings(): { searchProvider: string; fetchProvider: string };
    saveSettings(patch: { searchProvider?: string; fetchProvider?: string }): Promise<void>;
    hasCredential(providerId: string): boolean;
    writeCredential(providerId: string, key: string): void;
    clearCredential(providerId: string): void;
  };
  runtime: {
    refreshPrompt(): Promise<void>;
    refreshModelSelectors(): void;
  };
  commands: {
    refresh(): Promise<void>;
    listVaultEntries(): Promise<readonly SlashCatalogEntry[]>;
    listDropdownEntries(): Promise<readonly SlashCatalogEntry[]>;
    saveVaultEntry(entry: SlashCatalogEntry): Promise<void>;
    deleteVaultEntry(entry: SlashCatalogEntry): Promise<void>;
  };
  mcp: {
    load(): Promise<readonly ManagedMcpServer[]>;
    save(servers: readonly ManagedMcpServer[]): Promise<void>;
    test(server: ManagedMcpServer): Promise<McpTestResult>;
    /** Null when vault MCP OAuth is unavailable. */
    getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus | null>;
    /** Null when vault MCP OAuth is unavailable. */
    authenticate(server: ManagedMcpServer): Promise<McpAuthStatus | null>;
    logout(serverName: string): Promise<void>;
    reload(): Promise<void>;
  };
}

export interface SettingsSnapshotPort {
  getSnapshot(): SettingsUiSnapshotData;
}

export interface SettingsActionsPort {
  saveGeneral(patch: Partial<SettingsGeneralSnapshot>): Promise<void>;
  saveSubagents(patch: Partial<SettingsSubagentsSnapshot>): Promise<void>;
  purgeDeletedSessionFiles(): Promise<number>;
  openStyleSettings(): Promise<boolean>;
  setupNoteToolbarIntegration(
    itemStyle: 'label-and-icon' | 'icon-only',
  ): Promise<NoteToolbarSetupResultSnapshot>;
}

/** Persistence helpers for complex settings pages that still project full settings snapshots. */
export interface SettingsPersistencePort {
  getSettingsSnapshot(): PiviSettings;
  commitSettingsSnapshot(snapshot: PiviSettings): Promise<void>;
}

export interface SettingsEnvironmentPort {
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariables(scope: EnvironmentScope): string;
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  getReviewKeys(scope: EnvironmentScope, envText: string): readonly string[];
}

export interface SettingsHotkeysPort {
  listHotkeys(): readonly SettingsHotkeyRow[];
  openHotkeySettings(): void;
}

export interface SettingsCatalogPort {
  listModelsForProvider(providerId: string): ChatUIOption[];
  syncCustomProviders(snapshot: PiviSettings): void;
  fetchCustomProviderModels(
    providerId: string,
    snapshot: PiviSettings,
  ): Promise<{ count: number }>;
}

export interface SettingsPorts {
  snapshot: SettingsSnapshotPort;
  actions: SettingsActionsPort;
  complex: SettingsComplexPorts;
  persistence: SettingsPersistencePort;
  environment: SettingsEnvironmentPort;
  hotkeys: SettingsHotkeysPort;
  catalog: SettingsCatalogPort;
}

export interface InlineEditPort {
  createAuxQueryRunner(): AuxQueryRunner;
}
