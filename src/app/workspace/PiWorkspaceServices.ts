import { createSystemAuthContextHost } from "@pivi/obsidian-host/authContextHost";
import { isOfficialObsidianCliEnabled } from "@pivi/obsidian-host/cli/officialObsidianCli";
import type { PiviNetworkClients } from "@pivi/obsidian-host/createPiviNetworkClients";
import { inspectExternalDirectory } from "@pivi/obsidian-host/externalFileApi";
import { systemExternalOpener } from "@pivi/obsidian-host/openExternalUrl";
import { getVaultPath } from "@pivi/obsidian-host/path";
import { createFileProviderLegacyAuthStore } from "@pivi/obsidian-host/providerLegacyAuthStore";
import { systemProcessRunner } from "@pivi/obsidian-host/systemProcessRunner";
import {
  buildEffectiveBashAllowlist,
  createObsidianTools,
  getObsidianToolsSettingsFromBag,
} from "@pivi/obsidian-tools";
import { mergeCustomProviderHeaderSecrets } from "@pivi/pivi-agent-core/auth/customProviderHeaderSecrets";
import { credentialToApiKey } from "@pivi/pivi-agent-core/auth/piProviderCredentials";
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createCodexImageGenerator } from "@pivi/pivi-agent-core/engine/pi/codexImageGenerator";
import { configurePiAiModels } from "@pivi/pivi-agent-core/engine/pi/piAiModels";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/piProviderOAuthService";
import { registerBundledPiOAuthFlows } from "@pivi/pivi-agent-core/engine/pi/registerBundledPiOAuthFlows";
import { DesktopPiSessionTreeFactory } from "@pivi/pivi-agent-core/engine/pi/session/desktopPiSessionTree";
import { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";
import {
  type AppModelReadinessProvider,
  getCustomProvidersFromBag,
  getSubagentRuntimeSettingsFromBag,
  getWebSearchToolsSettingsFromBag,
  parseEnvironmentVariables,
  WEB_PROVIDER_IDS,
} from "@pivi/pivi-agent-core/foundation";
import { McpManagementCoordinator } from "@pivi/pivi-agent-core/mcp/mcpManagementCoordinator";
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
import { getMcpServerUrl } from "@pivi/pivi-agent-core/mcp/types";
import {
  grantPrivateOrigins,
} from "@pivi/pivi-agent-core/network";
import { ensureDefaultWorkspaceCommands } from "@pivi/pivi-agent-core/skills/commands/defaultWorkspaceCommands";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { AppSkillProvider } from "@pivi/pivi-agent-core/skills/skillProvider";
import { SkillsManagementCoordinator } from "@pivi/pivi-agent-core/skills/vault/skillsManagementCoordinator";
import { VaultSkillsService } from "@pivi/pivi-agent-core/skills/vault/vaultSkillsService";
import {
  createWebFetchTool,
  createWebSearchCredentialStore,
  createWebSearchTool,
  isObsidianAgentTool,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  type WebSearchCredentialStore,
} from "@pivi/pivi-agent-core/tools";

import { requestOAuthManualCode } from "@/app/oauthManualCodePrompt";

import { createBaseSessionTools } from "./baseSessionTools";
import {
  type ChatRuntimeServiceFactories,
  createChatRuntimeServiceFactories,
} from "./createChatRuntimeServices";
import { createCustomProviderHttpRequest } from "./obsidianHttpRequest";
import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";
import { createPiviManagementMainOnlyToolProviderFactory } from "./PiviManagementService";
import type { PiviWorkspaceHost, WorkspaceInitContext } from "./serviceContracts";
import { createVaultSkillsMetadataPort } from "./vaultSkillsMetadataPort";
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
  mcpManagement: McpManagementCoordinator;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpDiagnostics: AppMcpDiagnostics;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  skillsManagement: SkillsManagementCoordinator;
  mcpOAuth: McpOAuthService;
  credentialStore: ObsidianCredentialStore | null;
  webSearchCredentialStore: WebSearchCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
  network: PiviNetworkClients;
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
  const { owner, host, vaultAdapter, network } = context;
  const mcpStorage = new McpStorage(
    vaultAdapter,
    host.app.secretStorage,
  );
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(host.app.secretStorage, network.mcpFetch, systemExternalOpener, {
    callbackPort: readMcpOAuthCallbackPort(),
  });
  const credentialStore = createObsidianCredentialStore(
    host.app.secretStorage,
  );
  const webSearchCredentialStore = createWebSearchCredentialStore(
    host.app.secretStorage,
  );
  migrateLegacyWebSearchCredentials(webSearchCredentialStore, credentialStore);
  registerBundledPiOAuthFlows(network.providerFetch);
  const customProviders = isSecretStorageAvailable(host.app.secretStorage)
    ? mergeCustomProviderHeaderSecrets(
      host.app.secretStorage,
      getCustomProvidersFromBag(host.settings),
    )
    : getCustomProvidersFromBag(host.settings);
  grantPrivateOrigins(
    network.grants,
    customProviders.map((provider) => provider.baseUrl),
    "provider",
  );
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    providerFetch: network.providerFetch,
    authContext: new ObsidianAuthContext({
      settings: host.settings,
      getVaultPath: () => getVaultPath(host.app),
    }, createSystemAuthContextHost()),
    customProviders,
    httpGet: createCustomProviderHttpRequest(network.localProviderHttpClient),
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
      requestManualCode: (message, signal) => requestOAuthManualCode(host.app, message, signal),
    },
    createFileProviderLegacyAuthStore(vaultPath ? `${vaultPath}/.pivi/auth.json` : null),
  );
  const mcpToolProvider = new PiMcpToolProvider(
    mcpServerManager,
    mcpOAuth,
    network.mcpFetch,
    host.app.secretStorage,
    vaultPath ?? undefined,
  );
  const mcpDiagnostics = new PiMcpDiagnostics(
    mcpOAuth,
    network.mcpFetch,
    host.app.secretStorage,
    vaultPath ?? undefined,
  );
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester(
    network.mcpFetch,
    host.app.secretStorage,
    vaultPath ?? undefined,
  );
  const mcpManagement = new McpManagementCoordinator({
    storage: mcpStorage,
    toolProvider: mcpToolProvider,
    tester: mcpServerTester,
    secretStorage: host.app.secretStorage,
    removeOAuthArtifacts: serverName => mcpOAuth.logout(serverName),
    publish: async (servers, changedName) => {
      await mcpServerManager.loadServers();
      if (changedName === '*') mcpToolProvider.invalidateAll();
      else mcpToolProvider.invalidate(changedName);
      // Match Settings: re-grant purpose 'mcp' so Agent-added private origins work without reload.
      network.grants.revokeByPurpose('mcp');
      grantPrivateOrigins(
        network.grants,
        servers.map((server) => getMcpServerUrl(server.config)),
        'mcp',
      );
    },
  });
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(vaultPath, systemProcessRunner);
  const vaultSkillsService = new VaultSkillsService(vaultPath ?? "", {
    processRunner: systemProcessRunner,
  });
  const skillsManagement = new SkillsManagementCoordinator({
    service: vaultSkillsService,
    vaultPath: vaultPath ?? "",
    metadata: createVaultSkillsMetadataPort(host),
  });
  if (vaultPath) await skillsManagement.prepareWorkspace();
  await ensureDefaultWorkspaceCommands(
    vaultAdapter,
    host.settings,
    () => host.saveSettings(),
  );
  const slashCommandCatalog = new PiSlashCommandCatalog(
    owner,
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
  await slashCommandCatalog.prepareWorkspace();
  const baseToolProvider = createObsidianBaseToolProvider(host, providerOAuth, webSearchCredentialStore, network);
  const subagentConcurrencyLimiter = new SubagentConcurrencyLimiter(
    () => getSubagentRuntimeSettingsFromBag(host.settings).maxConcurrentSubagents,
  );
  const mainOnlyToolProviderFactory = createPiviManagementMainOnlyToolProviderFactory({
    mcp: mcpManagement,
    skills: skillsManagement,
    commands: slashCommandCatalog,
    refresh: {
      refreshPiviManagement: async (domain) => {
        if (!host.refreshPiviManagement) {
          throw new Error("Pivi management refresh host is unavailable.");
        }
        return host.refreshPiviManagement(domain);
      },
    },
  }, () => getObsidianToolsSettingsFromBag(host.settings).disabledTools ?? []);
  const chatRuntimeFactories = createChatRuntimeServiceFactories({
    mcpServerManager,
    mcpOAuth,
    baseToolProvider,
    mainOnlyToolProviderFactory,
    subagentConcurrencyLimiter,
    mcpSecretStorage: host.app.secretStorage,
    mcpFetch: network.mcpFetch,
    sessionTreeFactory: vaultPath ? new DesktopPiSessionTreeFactory(vaultPath) : null,
  });
  await mcpServerManager.loadServers();
  grantPrivateOrigins(
    network.grants,
    mcpServerManager
      .getServers()
      .map((server) => getMcpServerUrl(server.config)),
    "mcp",
  );
  // Warm MCP tool lists for slash/runtime without blocking workspace boot.
  void mcpToolProvider.prefetchEnabledServers().catch(() => {
    // Best-effort; first slash open or settings verify will retry.
  });

  return {
    mcpStorage,
    mcpManagement,
    mcpServerManager,
    mcpToolProvider,
    mcpDiagnostics,
    mcpServerProbeProvider,
    mcpServerTester,
    modelReadinessProvider,
    skillProvider,
    skillsManagement,
    mcpOAuth,
    credentialStore,
    webSearchCredentialStore,
    providerOAuth,
    slashCommandCatalog,
    network,
    dispose: async () => {
      network.grants.clear();
      subagentConcurrencyLimiter.dispose();
      providerOAuth.dispose();
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
  network: PiviNetworkClients,
): PiBaseToolProvider {
  return ({ externalContextPaths, resolveReadMaxChars, capabilityApproval }) => {
    const settings = getObsidianToolsSettingsFromBag(host.settings);
    const externalContexts = (externalContextPaths ?? []).map((contextPath) => (
      host.platformCapabilities.externalFileAccess && settings.allowExternalRead
        ? inspectExternalDirectory(contextPath)
        : { path: contextPath, available: false, reason: 'external-read-disabled' }
    ));
    const availableExternalPaths = externalContexts
      .filter((context) => context.available)
      .map((context) => context.path);
    // Settings directories are the pin catalog. The checked turn selection is
    // the complete access list for this chat runtime.
    const runtimeSettings = {
      ...settings,
      allowBash: host.platformCapabilities.processExecution && settings.allowBash,
      allowCommand: host.platformCapabilities.officialObsidianCli && settings.allowCommand,
      allowEval: host.platformCapabilities.officialObsidianCli && settings.allowEval,
      allowExternalRead: host.platformCapabilities.externalFileAccess && settings.allowExternalRead,
      externalReadDirectories: [],
    };
    const obsidianCliAvailable = host.platformCapabilities.officialObsidianCli
      && settings.cliEnabled
      && isOfficialObsidianCliEnabled();
    const imageGenerator = providerOAuth.hasCodexAuth()
      ? createCodexImageGenerator({
        fetch: network.imageFetch,
        getAccessToken: async () => providerOAuth.getCodexApiKey(),
      })
      : undefined;
    const toolSpecs = createObsidianTools(host.app, runtimeSettings, {
      imageGenerator,
      externalReadDirectories: availableExternalPaths,
      obsidianCliAvailable,
      resolveReadMaxChars,
      capabilityApproval: capabilityApproval ?? null,
    });

    toolSpecs.push(...createBaseSessionTools(host.sessionRecovery, settings.disabledTools));

    const webSearchSettings = getWebSearchToolsSettingsFromBag(host.settings);
    const environmentVariables = parseEnvironmentVariables(
      host.settings.agentSettings?.environmentVariables ?? '',
    );
    toolSpecs.push(
      createWebSearchTool({
        fetch: network.webSearchFetch,
        providerOrder: webSearchSettings.providerOrder,
        disabledProviders: webSearchSettings.disabledProviders,
        getCredential: (providerId) =>
          webSearchCredentialStore?.readSync(providerId),
        environmentVariables,
      }),
      createWebFetchTool({
        fetch: network.webFetch,
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
    const bashEnabled = obsidianTools.includes(TOOL_OBSIDIAN_BASH);

    return {
      toolSpecs,
      externalContexts,
      registeredToolSummary: {
        obsidianTools,
        obsidianCliAvailable,
        ...(bashEnabled ? { bashAllowlist: buildEffectiveBashAllowlist(settings.bashAllowlist) } : {}),
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
