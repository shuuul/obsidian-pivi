import type { OpenSessionState, PiviSettings, SessionSummary } from '@pivi/core';
import type { EnvironmentScope } from '@pivi/core/settings';
import type { McpServerManager } from '@pivi/mcp/McpServerManager';
import type { McpOAuthService } from '@pivi/mcp/oauth/McpOAuthService';
import type { AgentHostContext } from '@pivi/obsidian-host/bootstrap/hostContext';
import type { SharedAppStorage } from '@pivi/obsidian-host/bootstrap/storage';
import type { AppTabManagerState } from '@pivi/obsidian-host/bootstrap/types';
import type {
  AgentSettingsTabRenderer,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
} from '@pivi/obsidian-host/serviceContracts';
import type { ObsidianCredentialStore } from '@pivi/pi-runtime/auth/ObsidianCredentialStore';
import type { ProviderOAuthService } from '@pivi/pi-runtime/auth/ProviderOAuthService';
import type { LeafSummary } from '@pivi/session';
import type { SlashCommandCatalog } from '@pivi/skills/commands/SlashCommandCatalog';
import type { App } from 'obsidian';
import type { Plugin } from 'obsidian';

import type { PiviView } from '@/ui/chat/view/PiviView';

/** Workspace services exposed to chat/settings UI by the Obsidian plugin shell. */
export interface PiviPluginWorkspace {
  settingsTabRenderer: AgentSettingsTabRenderer;
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService | null;
  providerOAuth?: ProviderOAuthService;
  credentialStore?: ObsidianCredentialStore | null;
  slashCommandCatalog: SlashCommandCatalog;
}

/** Narrow host surface used by plugin UI (implemented by the plugin class). */
export interface PiviPluginHost extends Plugin {
  app: App;
  settings: PiviSettings;

  storage: SharedAppStorage;

  saveSettings(): Promise<void>;
  getAgentHostContext(): AgentHostContext;
  getPiWorkspace(): PiviPluginWorkspace | null;
  getView(): PiviView | null;
  getOpenSessionById(
    id: string,
    leafId?: string | null,
  ): Promise<OpenSessionState | null>;
  getOpenSessionSync(id: string): OpenSessionState | null;
  getSessionList(): SessionSummary[];
  getAllViews(): PiviView[];
  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string, leafId?: string | null): Promise<OpenSessionState>;
  switchSession(id: string, leafId?: string | null): Promise<OpenSessionState | null>;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  listSessionLeaves(sessionFile: string): Promise<LeafSummary[]>;
  forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
  findSessionAcrossViews(openSessionId: string): { view: PiviView; tabId: string } | null;
  persistTabManagerState(state: AppTabManagerState): Promise<void>;
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
}

export type { PiviPluginHost as default,PiviPluginHost as PiviPlugin };
