import { createSystemAuthContextHost } from "@pivi/obsidian-host/authContextHost";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import { inspectExternalDirectory } from "@pivi/obsidian-host/externalFileApi";
import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import { systemExternalOpener } from "@pivi/obsidian-host/openExternalUrl";
import { getVaultPath } from "@pivi/obsidian-host/path";
import { createFileProviderLegacyAuthStore } from "@pivi/obsidian-host/providerLegacyAuthStore";
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
import { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";
import {
  type AppModelReadinessProvider,
  getCustomProvidersFromBag,
  getSubagentRuntimeSettingsFromBag,
  getWebSearchToolsSettingsFromBag,
  parseEnvironmentVariables,
  WEB_PROVIDER_IDS,
} from "@pivi/pivi-agent-core/foundation";
import { McpServerManager } from "@pivi/pivi-agent-core/mcp/mcpServerManager";
import { McpStorage } from "@pivi/pivi-agent-core/mcp/mcpStorage";
import { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import type {
  AppMcpDiagnostics,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
} from "@pivi/pivi-agent-core/mcp/ports";
import { ensureDefaultWorkspaceCommands } from "@pivi/pivi-agent-core/skills/commands/defaultWorkspaceCommands";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { AppSkillProvider } from "@pivi/pivi-agent-core/skills/skillProvider";
import {
  createWebFetchTool,
  createWebSearchCredentialStore,
  createWebSearchTool,
  isObsidianAgentTool,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  type WebSearchCredentialStore,
} from "@pivi/pivi-agent-core/tools";

import {
  type ChatRuntimeServiceFactories,
  createChatRuntimeServiceFactories,
} from "./createChatRuntimeServices";
import { obsidianCustomProviderHttpRequest } from "./obsidianHttpRequest";
import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";
import type { PiviWorkspaceHost, WorkspaceInitContext } from "./serviceContracts";
import {
  PiMcpDiagnostics,
  PiMcpServerProbeProvider,
  PiMcpServerTester,
  PiMcpToolProvider,
  PiModelReadinessProvider,
  PiSkillProvider,
} from "./workspaceServiceProviders";

export interface PiWorkspaceServices extends ChatRuntimeServiceFactories {
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpDiagnostics: AppMcpDiagnostics;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService;
  credentialStore: ObsidianCredentialStore | null;
  webSearchCredentialStore: WebSearchCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
  dispose(): Promise<void>;
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
  const { host, vaultAdapter } = context;
  const mcpStorage = new McpStorage(
    vaultAdapter,
    host.app.secretStorage,
  );
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(vaultAdapter, nodeFetch, systemExternalOpener, {
    callbackPort: readMcpOAuthCallbackPort(),
  });
  const credentialStore = createObsidianCredentialStore(
    host.app.secretStorage,
  );
  const webSearchCredentialStore = createWebSearchCredentialStore(
    host.app.secretStorage,
  );
  migrateLegacyWebSearchCredentials(webSearchCredentialStore, credentialStore);
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    authContext: new ObsidianAuthContext({
      settings: host.settings,
      getVaultPath: () => getVaultPath(host.app),
    }, createSystemAuthContextHost()),
    customProviders: getCustomProvidersFromBag(host.settings),
    httpGet: obsidianCustomProviderHttpRequest,
    getApiKey: (providerId) => {
      const credential = credentialStore?.readSync(providerId);
      return credentialToApiKey(credential) ?? undefined;
    },
  });
  const vaultPath = getVaultPath(host.app);
  const providerOAuth = new ProviderOAuthService(
    credentialStore,
    {
      openAuthUrl: (url) => systemExternalOpener.openExternalUrl(url),
    },
    createFileProviderLegacyAuthStore(vaultPath ? `${vaultPath}/.pivi/auth.json` : null),
  );
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const mcpDiagnostics = new PiMcpDiagnostics(mcpOAuth);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester();
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(vaultPath, systemProcessRunner);
  await ensureDefaultWorkspaceCommands(
    vaultAdapter,
    host.settings,
    () => host.saveSettings(),
  );
  const slashCommandCatalog = new PiSlashCommandCatalog(
    host,
    vaultAdapter,
    {
      onWorkspaceEntriesChanged: entries => host.reconcileWorkspaceCommandEntries(entries),
      isImageGenerationEnabled: () => (
        providerOAuth.hasCodexAuth()
        && !(getObsidianToolsSettingsFromBag(host.settings).disabledTools ?? []).includes(
          TOOL_OBSIDIAN_GENERATE_IMAGE,
        )
      ),
    },
  );
  const baseToolProvider = createObsidianBaseToolProvider(host, providerOAuth, webSearchCredentialStore);
  const subagentConcurrencyLimiter = new SubagentConcurrencyLimiter(
    () => getSubagentRuntimeSettingsFromBag(host.settings).maxConcurrentSubagents,
  );
  const chatRuntimeFactories = createChatRuntimeServiceFactories({
    mcpServerManager,
    mcpOAuth,
    baseToolProvider,
    subagentConcurrencyLimiter,
  });
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  // Warm MCP tool lists for slash/runtime without blocking workspace boot.
  void mcpToolProvider.prefetchEnabledServers().catch(() => {
    // Best-effort; first slash open or settings verify will retry.
  });

  return {
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    mcpDiagnostics,
    mcpServerProbeProvider,
    mcpServerTester,
    modelReadinessProvider,
    skillProvider,
    mcpOAuth,
    credentialStore,
    webSearchCredentialStore,
    providerOAuth,
    slashCommandCatalog,
    dispose: async () => {
      subagentConcurrencyLimiter.dispose();
      await Promise.all([
        mcpToolProvider.dispose(),
        mcpDiagnostics.dispose(),
        mcpOAuth.dispose(),
      ]);
    },
    ...chatRuntimeFactories,
  };
}

function createObsidianBaseToolProvider(
  host: PiviWorkspaceHost,
  providerOAuth: ProviderOAuthService,
  webSearchCredentialStore: WebSearchCredentialStore | null,
): PiBaseToolProvider {
  return ({ externalContextPaths }) => {
    const settings = getObsidianToolsSettingsFromBag(host.settings);
    const externalContexts = (externalContextPaths ?? []).map((contextPath) => (
      settings.allowExternalRead
        ? inspectExternalDirectory(contextPath)
        : { path: contextPath, available: false, reason: 'external-read-disabled' }
    ));
    const availableExternalPaths = externalContexts
      .filter((context) => context.available)
      .map((context) => context.path);
    // Settings directories are the pin catalog. The checked turn selection is
    // the complete access list for this chat runtime.
    const runtimeSettings = { ...settings, externalReadDirectories: [] };
    const obsidianCliAvailable = settings.cliEnabled && isOfficialObsidianCliEnabled();
    const imageGenerator = providerOAuth.hasCodexAuth()
      ? createCodexImageGenerator({
        fetch: nodeFetch,
        getAccessToken: async () => providerOAuth.getCodexApiKey(),
      })
      : undefined;
    const toolSpecs = createObsidianTools(host.app, runtimeSettings, {
      imageGenerator,
      externalReadDirectories: availableExternalPaths,
      obsidianCliAvailable,
    });

    const webSearchSettings = getWebSearchToolsSettingsFromBag(host.settings);
    const environmentVariables = parseEnvironmentVariables(
      host.settings.agentSettings?.environmentVariables ?? '',
    );
    toolSpecs.push(
      createWebSearchTool({
        fetch: nodeFetch,
        providerOrder: webSearchSettings.providerOrder,
        disabledProviders: webSearchSettings.disabledProviders,
        getCredential: (providerId) =>
          webSearchCredentialStore?.readSync(providerId),
        environmentVariables,
      }),
      createWebFetchTool({
        fetch: nodeFetch,
        providerOrder: webSearchSettings.providerOrder,
        disabledProviders: webSearchSettings.disabledProviders,
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
      externalContexts,
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

  for (const providerId of WEB_PROVIDER_IDS) {
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
