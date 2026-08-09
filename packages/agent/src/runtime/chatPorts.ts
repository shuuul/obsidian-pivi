import type {
  AppModelReadinessProvider,
  OpenSessionState,
  SessionSummary,
} from '../foundation';
import type {
  ChatModeSelectorConfig,
  ChatReasoningOption,
  ChatUIOption,
} from '../foundation/chatUi';
import type { CustomProviderConfig } from '../foundation/customProviders';
import type { KeyboardNavigationSettings } from '../foundation/settings';
import type { ManagedMcpServer } from '../mcp/types';
import type { CapabilityApprovalPort } from '../ports/capabilityApproval';
import type { SessionMessagePage } from '../session';
import type { SlashCommandDropdownConfig } from '../skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '../skills/commands/slashCommandEntry';
import type { PiviManagementApprovalPort } from '../tools/piviManagement/approval';
import type { AuxQueryRunner } from './auxQueryRunner';
import type { PiChatService } from './piChatService';

export interface ChatRuntimePort {
  createChatService(options?: {
    capabilityApproval?: CapabilityApprovalPort | null;
    piviManagementApproval?: PiviManagementApprovalPort | null;
  }): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
}

export interface ChatSessionPort {
  listSessions(): SessionSummary[];
  /** Returns only an already-open in-memory session; never hydrates from disk. */
  findOpenSession(id: string): OpenSessionState | null;
  /** Returns open-session metadata without hydrating the full JSONL transcript. */
  getOpenSession(id: string): Promise<OpenSessionState | null>;
  openRecent(id: string, limit: number): Promise<SessionMessagePage | null>;
  readOlder(
    id: string,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage | null>;
  createSession(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState>;
  openSessionFile(sessionFile: string): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  deleteSessionFile(sessionFile: string, openSessionId?: string | null): Promise<void>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  forkSession(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
}

export interface ChatCatalogPort {
  listMcpServers(): ManagedMcpServer[];
  listContextSavingMcpServers(): ManagedMcpServer[];
  listMcpTools(serverName: string): Promise<Array<{ name: string; description?: string }>>;
  /**
   * Automatic slash-cache inventory path. Prefer a non-authenticating provider
   * seam that cannot start stdio or persist OAuth; falls back to listMcpTools
   * only when the host has not wired a dedicated inventory method.
   */
  listMcpInventoryTools?(serverName: string): Promise<Array<{ name: string; description?: string }>>;
  listSkills(): Array<{ name: string; description?: string }>;
  listSlashEntries(includeBuiltIns: boolean): Promise<SlashCatalogEntry[]>;
  getSlashDropdownConfig(): SlashCommandDropdownConfig;
  refreshSlashCatalog(): Promise<void>;
}

export type ChatModelReadinessPort = Pick<
  AppModelReadinessProvider,
  'getStatus' | 'testModel'
>;

export interface ChatModelCatalogSnapshot {
  addedProviders: string[];
  disabledProviders: string[];
  visibleModels: string[];
  customProviders: CustomProviderConfig[];
}

export interface ChatSettingsSnapshot {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  customContextLimits: Record<string, number>;
  enableAutoScroll: boolean;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;
  userName: string;
  excludedTags: string[];
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;
  environmentVariables: string;
  externalReadDirectories: string[];
  hiddenSlashCommands: string[];
  modelCatalog: ChatModelCatalogSnapshot;
}

export interface ChatModelsPort {
  getModelOptions(settings: ChatSettingsSnapshot): ChatUIOption[];
  isAdaptiveReasoningModel(model: string, settings: ChatSettingsSnapshot): boolean;
  getReasoningOptions(model: string, settings: ChatSettingsSnapshot): ChatReasoningOption[];
  getDefaultReasoningValue(model: string, settings: ChatSettingsSnapshot): string;
  getContextWindowSize(model: string, customLimits?: Record<string, number>): number | null;
  applyModelDefaults(model: string, settings: ChatSettingsSnapshot): void;
  applyReasoningSelection?(
    model: string,
    value: string,
    settings: ChatSettingsSnapshot,
  ): void;
  getModeSelector?(settings: ChatSettingsSnapshot): ChatModeSelectorConfig | null;
  applyModeSelection?(value: string, settings: ChatSettingsSnapshot): void;
  getReadinessProvider(): ChatModelReadinessPort | null;
  prepareModelMetadata(model: string): Promise<void>;
}

export interface ChatSettingsPort {
  getSettingsSnapshot(): ChatSettingsSnapshot;
  commitSettingsSnapshot(snapshot: ChatSettingsSnapshot): Promise<void>;
  setPinnedExternalReadDirectories(paths: string[]): Promise<void>;
  appendBashAllowlistEntry?(command: string): Promise<void>;
  appendExternalReadDirectory?(directory: string): Promise<void>;
}

export interface ChatPorts {
  runtime: ChatRuntimePort;
  sessions: ChatSessionPort;
  catalog: ChatCatalogPort;
  models: ChatModelsPort;
  settings: ChatSettingsPort;
}
