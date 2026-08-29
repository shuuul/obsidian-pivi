import { mergeCustomProviderHeaderSecrets } from "@pivi/agent/auth/customProviderHeaderSecrets";
import { credentialToApiKey } from "@pivi/agent/auth/piProviderCredentials";
import { isSecretStorageAvailable } from "@pivi/agent/auth/providerSecretStorage";
import { McpManagementCoordinator } from "@pivi/agent/mcp/mcpManagementCoordinator";
import { McpServerManager } from "@pivi/agent/mcp/mcpServerManager";
import { McpStorage } from "@pivi/agent/mcp/mcpStorage";
import { McpOAuthService } from "@pivi/agent/mcp/oauth/mcpOAuthService";
import type {
  AppMcpDiagnostics,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
} from "@pivi/agent/mcp/ports";
import { getMcpServerUrl } from "@pivi/agent/mcp/types";
import {
  grantPrivateOrigins,
} from "@pivi/agent/network";
import { type AppModelReadinessProvider, getCustomProvidersFromBag, getSubagentRuntimeSettingsFromBag, getWebSearchToolsSettingsFromBag, parseEnvironmentVariables, WEB_PROVIDER_IDS } from "@pivi/agent/settings";
import { ensureDefaultWorkspaceCommands } from "@pivi/agent/skills/commands/defaultWorkspaceCommands";
import type { SlashCommandCatalog } from "@pivi/agent/skills/commands/slashCommandCatalog";
import type { AppSkillProvider } from "@pivi/agent/skills/skillProvider";
import { SkillsManagementCoordinator } from "@pivi/agent/skills/vault/skillsManagementCoordinator";
import { VaultSkillsService } from "@pivi/agent/skills/vault/vaultSkillsService";
import {
  createWebFetchTool,
  createWebSearchCredentialStore,
  createWebSearchTool,
  isObsidianAgentTool,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  type WebSearchCredentialStore,
} from "@pivi/agent/tools";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "@pivi/engine-pi/application/auth";
import { configurePiAiModels } from "@pivi/engine-pi/application/models";
import { ProviderOAuthService } from "@pivi/engine-pi/application/oauth";
import { registerBundledPiOAuthFlows } from "@pivi/engine-pi/application/oauth-flows";
import {
  createCodexImageGenerator,
  type PiBaseToolProvider,
  SubagentConcurrencyLimiter,
} from "@pivi/engine-pi/application/runtime";
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
  resolveLoginShellPath,
} from "@pivi/obsidian-tools";

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
  McpDiagnostics,
  McpServerProbeProvider,
  McpServerTester,
  McpToolProvider,
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
  const { host, vaultAdapter, network } = context;
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
  const mcpToolProvider = new McpToolProvider(
    mcpServerManager,
    mcpOAuth,
    network.mcpFetch,
    host.app.secretStorage,
    vaultPath ?? undefined,
  );
  const mcpDiagnostics = new McpDiagnostics(
    mcpOAuth,
    network.mcpFetch,
    host.app.secretStorage,
    vaultPath ?? undefined,
  );
  const mcpServerProbeProvider = new McpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new McpServerTester(
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
        ...(bashEnabled ? { bashAllowlist: buildEffectiveBashAllowlist(settings.bashAllowlist, resolveLoginShellPath()) } : {}),
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
