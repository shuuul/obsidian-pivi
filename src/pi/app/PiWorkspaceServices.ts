import type PiviPlugin from "../../main";
import type { SlashCommandCatalog } from "../../pi/agent/commands/SlashCommandCatalog";
import { McpServerManager } from "../../pi/mcp/McpServerManager";
import type { SessionStore } from "../../pi/session/types";
import { getVaultPath } from "../../utils/path";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "../auth/ObsidianCredentialStore";
import { ProviderOAuthService } from "../auth/ProviderOAuthService";
import { McpStorage } from "../mcp/McpStorage";
import { initializeOAuth } from "../mcp/oauth/McpAuthFlow";
import { McpOAuthService } from "../mcp/oauth/McpOAuthService";
import { configurePiAiModels } from "../piAiModels";
import { piSettingsTabRenderer } from "../ui/PiSettingsTab";
import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";
import type {
  AgentSettingsTabRenderer,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
  WorkspaceInitContext,
} from "./serviceContracts";
import {
  PiMcpServerProbeProvider,
  PiMcpServerTester,
  PiMcpToolProvider,
  PiModelReadinessProvider,
  PiSkillProvider,
} from "./workspaceServiceProviders";

export interface PiWorkspaceServices {
  settingsTabRenderer: AgentSettingsTabRenderer;
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService;
  credentialStore: ObsidianCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
  sessionStore: SessionStore | null;
}

export async function createPiWorkspaceServices(
  context: WorkspaceInitContext,
): Promise<PiWorkspaceServices> {
  const plugin = context.host.rawHost as PiviPlugin;
  const mcpStorage = new McpStorage(
    context.vaultAdapter,
    plugin.app.secretStorage,
  );
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(context.vaultAdapter);
  const credentialStore = createObsidianCredentialStore(
    plugin.app.secretStorage,
  );
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    authContext: new ObsidianAuthContext(plugin),
  });
  const providerOAuth = new ProviderOAuthService(plugin.app, credentialStore);
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester();
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(getVaultPath(plugin.app));
  const slashCommandCatalog = new PiSlashCommandCatalog(
    plugin,
    context.vaultAdapter,
  );
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: piSettingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    mcpServerProbeProvider,
    mcpServerTester,
    modelReadinessProvider,
    skillProvider,
    mcpOAuth,
    credentialStore,
    providerOAuth,
    slashCommandCatalog,
    sessionStore: context.host.sessionStore ?? null,
  };
}
