import { ObsidianVaultApi } from "@pivi/obsidian-host";
import { createSystemAuthContextHost } from "@pivi/obsidian-host/AuthContextHost";
import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import { systemExternalOpener } from "@pivi/obsidian-host/openExternalUrl";
import { getVaultPath } from "@pivi/obsidian-host/path";
import { createFileProviderLegacyAuthStore } from "@pivi/obsidian-host/ProviderLegacyAuthStore";
import type {
  AgentSettingsTabRenderer,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
  WorkspaceInitContext,
} from "@pivi/obsidian-host/serviceContracts";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import {
  createObsidianToolSpecs,
  createResolveApprovalPattern,
  getObsidianToolsSettingsFromBag,
} from "@pivi/obsidian-tools";
import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createGatedApproval } from "@pivi/pivi-agent-core/engine/pi/createGatedApproval";
import { configurePiAiModels } from "@pivi/pivi-agent-core/engine/pi/PiAiModels";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "@pivi/pivi-agent-core/engine/pi/PiProviderCredentialStore";
import { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/PiProviderOAuthService";
import { McpServerManager } from "@pivi/pivi-agent-core/mcp/McpServerManager";
import { McpStorage } from "@pivi/pivi-agent-core/mcp/McpStorage";
import { initializeOAuth } from "@pivi/pivi-agent-core/mcp/oauth/McpAuthFlow";
import { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/McpOAuthService";
import type { SessionStore } from "@pivi/pivi-agent-core/session";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/SlashCommandCatalog";
import { OBSIDIAN_AGENT_TOOLS } from "@pivi/pivi-agent-core/tools";

import type PiviPlugin from "@/main";
import { piSettingsTabRenderer } from "@/ui/settings/PiSettingsTab";

import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";
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
  baseToolProvider: PiBaseToolProvider;
}

function readMcpOAuthCallbackPort(): number | undefined {
  const rawPort = process.env.MCP_OAUTH_CALLBACK_PORT;
  if (!rawPort) {
    return undefined;
  }
  const parsedPort = Number.parseInt(rawPort, 10);
  return Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : undefined;
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
  const mcpOAuth = new McpOAuthService(context.vaultAdapter, nodeFetch, systemExternalOpener, {
    callbackPort: readMcpOAuthCallbackPort(),
  });
  const credentialStore = createObsidianCredentialStore(
    plugin.app.secretStorage,
  );
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    authContext: new ObsidianAuthContext(plugin, createSystemAuthContextHost()),
  });
  const vaultPath = getVaultPath(plugin.app);
  const providerOAuth = new ProviderOAuthService(
    credentialStore,
    {
      openAuthUrl: (url) => systemExternalOpener.openExternalUrl(url),
    },
    createFileProviderLegacyAuthStore(vaultPath ? `${vaultPath}/.pivi/auth.json` : null),
  );
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester();
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(vaultPath, systemProcessRunner);
  const slashCommandCatalog = new PiSlashCommandCatalog(
    plugin,
    context.vaultAdapter,
  );
  const baseToolProvider = createObsidianBaseToolProvider(plugin);
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
    baseToolProvider,
  };
}

function createObsidianBaseToolProvider(plugin: PiviPlugin): PiBaseToolProvider {
  return ({ vaultPath, approvalCallback, sessionApprovalRules }) => {
    const settings = getObsidianToolsSettingsFromBag(plugin.settings);
    const vaultApi = new ObsidianVaultApi(plugin.app);
    const resolvePattern = createResolveApprovalPattern(vaultApi, vaultPath || null);
    const approve = createGatedApproval(
      approvalCallback,
      sessionApprovalRules,
      resolvePattern,
    );

    return {
      toolSpecs: createObsidianToolSpecs(plugin.app, settings, approve),
      registeredToolSummary: {
        obsidianTools: OBSIDIAN_AGENT_TOOLS,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        allowCommand: settings.allowCommand,
        allowEval: settings.allowEval,
      },
    };
  };
}
