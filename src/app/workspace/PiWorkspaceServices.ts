import { createSystemAuthContextHost } from "@pivi/obsidian-host/authContextHost";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import { systemExternalOpener } from "@pivi/obsidian-host/openExternalUrl";
import { getVaultPath } from "@pivi/obsidian-host/path";
import { createFileProviderLegacyAuthStore } from "@pivi/obsidian-host/providerLegacyAuthStore";
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
  createObsidianTools,
  getObsidianToolsSettingsFromBag,
} from "@pivi/obsidian-tools";
import { credentialToApiKey } from "@pivi/pivi-agent-core/auth/piProviderCredentials";
import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createCodexImageGenerator } from "@pivi/pivi-agent-core/engine/pi/codexImageGenerator";
import { configurePiAiModels } from "@pivi/pivi-agent-core/engine/pi/piAiModels";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/piProviderOAuthService";
import {
  getWebSearchToolsSettingsFromBag,
  parseEnvironmentVariables,
  WEB_SEARCH_PROVIDER_IDS,
} from "@pivi/pivi-agent-core/foundation";
import { McpServerManager } from "@pivi/pivi-agent-core/mcp/mcpServerManager";
import { McpStorage } from "@pivi/pivi-agent-core/mcp/mcpStorage";
import { initializeOAuth } from "@pivi/pivi-agent-core/mcp/oauth/mcpAuthFlow";
import { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import type { SessionStore } from "@pivi/pivi-agent-core/session";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import {
  createWebFetchTool,
  createWebSearchCredentialStore,
  createWebSearchTool,
  isObsidianAgentTool,
  type WebSearchCredentialStore,
} from "@pivi/pivi-agent-core/tools";

import type PiviPlugin from "@/main";

import {
  type ChatRuntimeServiceFactories,
  createChatRuntimeServiceFactories,
} from "./createChatRuntimeServices";
import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";
import {
  PiMcpServerProbeProvider,
  PiMcpServerTester,
  PiMcpToolProvider,
  PiModelReadinessProvider,
  PiSkillProvider,
} from "./workspaceServiceProviders";

export interface PiWorkspaceServices extends ChatRuntimeServiceFactories {
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
  webSearchCredentialStore: WebSearchCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
  sessionStore: SessionStore | null;
  baseToolProvider: PiBaseToolProvider;
}

export interface CreatePiWorkspaceServicesOptions {
  /** Injected by composition root so workspace never imports product UI. */
  settingsTabRenderer: AgentSettingsTabRenderer;
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
  options: CreatePiWorkspaceServicesOptions,
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
  const webSearchCredentialStore = createWebSearchCredentialStore(
    plugin.app.secretStorage,
  );
  migrateLegacyWebSearchCredentials(webSearchCredentialStore, credentialStore);
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
    { isImageGenerationAvailable: () => providerOAuth.hasCodexAuth() },
  );
  const baseToolProvider = createObsidianBaseToolProvider(plugin, providerOAuth, webSearchCredentialStore);
  const chatRuntimeFactories = createChatRuntimeServiceFactories({
    mcpServerManager,
    mcpOAuth,
    baseToolProvider,
  });
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: options.settingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    mcpServerProbeProvider,
    mcpServerTester,
    modelReadinessProvider,
    skillProvider,
    mcpOAuth,
    credentialStore,
    webSearchCredentialStore,
    providerOAuth,
    slashCommandCatalog,
    sessionStore: context.host.sessionStore ?? null,
    baseToolProvider,
    ...chatRuntimeFactories,
  };
}

function createObsidianBaseToolProvider(
  plugin: PiviPlugin,
  providerOAuth: ProviderOAuthService,
  webSearchCredentialStore: WebSearchCredentialStore | null,
): PiBaseToolProvider {
  return ({ externalContextPaths }) => {
    const settings = getObsidianToolsSettingsFromBag(plugin.settings);
    const obsidianCliAvailable = settings.cliEnabled && isOfficialObsidianCliEnabled();
    const imageGenerator = providerOAuth.hasCodexAuth()
      ? createCodexImageGenerator({
        fetch: nodeFetch,
        getAccessToken: async () => providerOAuth.getCodexApiKey(),
      })
      : undefined;
    const toolSpecs = createObsidianTools(plugin.app, settings, {
      imageGenerator,
      externalReadDirectories: externalContextPaths,
      obsidianCliAvailable,
    });

    const webSearchSettings = getWebSearchToolsSettingsFromBag(plugin.settings);
    const environmentVariables = parseEnvironmentVariables(
      plugin.settings.agentSettings?.environmentVariables ?? '',
    );
    toolSpecs.push(
      createWebSearchTool({
        fetch: nodeFetch,
        preferredProvider: webSearchSettings.searchProvider,
        getCredential: (providerId) =>
          webSearchCredentialStore?.readSync(providerId),
        environmentVariables,
      }),
      createWebFetchTool({
        fetch: nodeFetch,
        preferredProvider: webSearchSettings.fetchProvider,
        getCredential: (providerId) =>
          webSearchCredentialStore?.readSync(providerId),
        environmentVariables,
      }),
    );
    const includeWebSearch = true;

    const obsidianTools = toolSpecs
      .map((tool) => tool.name)
      .filter(isObsidianAgentTool);

    return {
      toolSpecs,
      registeredToolSummary: {
        obsidianTools,
        obsidianCliAvailable,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        includeWebSearch,
      },
    };
  };
}

function migrateLegacyWebSearchCredentials(
  webSearchCredentialStore: WebSearchCredentialStore | null,
  credentialStore: ObsidianCredentialStore | null,
): void {
  if (!webSearchCredentialStore || !credentialStore) {
    return;
  }

  for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
    const legacyApiKey = credentialToApiKey(credentialStore.readSync(providerId));
    if (!legacyApiKey) {
      continue;
    }
    if (!webSearchCredentialStore.readSync(providerId)) {
      webSearchCredentialStore.writeSync(providerId, legacyApiKey);
    }
    credentialStore.clearSync(providerId);
  }
}
