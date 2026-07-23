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
import { getMcpServerUrl } from "@pivi/pivi-agent-core/mcp/types";
import {
  classifyHostnameOrAddress,
  isDeniedIpClass,
  normalizeHttpUrl,
  type OriginGrantRegistry,
} from "@pivi/pivi-agent-core/network";
import { ensureDefaultWorkspaceCommands } from "@pivi/pivi-agent-core/skills/commands/defaultWorkspaceCommands";
import type { SlashCommandCatalog } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { AppSkillProvider } from "@pivi/pivi-agent-core/skills/skillProvider";
import {
  createWebFetchTool,
  createWebSearchCredentialStore,
  createWebSearchTool,
  isObsidianAgentTool,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  type WebSearchCredentialStore,
} from "@pivi/pivi-agent-core/tools";

import {
  type ChatRuntimeServiceFactories,
  createChatRuntimeServiceFactories,
} from "./createChatRuntimeServices";
import { createCustomProviderHttpRequest } from "./obsidianHttpRequest";
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


/** Grant configured private origins for the plugin lifetime (origin-scoped, not a global bypass). */
function grantConfiguredPrivateOrigins(
  grants: OriginGrantRegistry,
  urls: readonly string[],
  purpose: "mcp" | "provider",
): void {
  const ttlMs = 24 * 60 * 60 * 1000;
  for (const raw of urls) {
    try {
      const url = normalizeHttpUrl(raw);
      const classification = classifyHostnameOrAddress(url.hostname);
      if (isDeniedIpClass(classification) || url.hostname.toLowerCase() === "localhost") {
        grants.grant(url, ttlMs, purpose);
      }
    } catch {
      // Ignore malformed configured URLs; validation surfaces elsewhere.
    }
  }
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
  grantConfiguredPrivateOrigins(
    network.grants,
    customProviders.map((provider) => provider.baseUrl).filter(Boolean),
    "provider",
  );
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
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
    },
    createFileProviderLegacyAuthStore(vaultPath ? `${vaultPath}/.pivi/auth.json` : null),
  );
  const mcpToolProvider = new PiMcpToolProvider(
    mcpServerManager,
    mcpOAuth,
    network.mcpFetch,
    host.app.secretStorage,
  );
  const mcpDiagnostics = new PiMcpDiagnostics(mcpOAuth, network.mcpFetch, host.app.secretStorage);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester(network.mcpFetch, host.app.secretStorage);
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
  const baseToolProvider = createObsidianBaseToolProvider(host, providerOAuth, webSearchCredentialStore, network);
  const subagentConcurrencyLimiter = new SubagentConcurrencyLimiter(
    () => getSubagentRuntimeSettingsFromBag(host.settings).maxConcurrentSubagents,
  );
  const chatRuntimeFactories = createChatRuntimeServiceFactories({
    mcpServerManager,
    mcpOAuth,
    baseToolProvider,
    subagentConcurrencyLimiter,
    mcpSecretStorage: host.app.secretStorage,
    mcpFetch: network.mcpFetch,
  });
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  grantConfiguredPrivateOrigins(
    network.grants,
    mcpServerManager
      .getServers()
      .map((server) => getMcpServerUrl(server.config))
      .filter((url): url is string => Boolean(url)),
    "mcp",
  );
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
  return ({ externalContextPaths, resolveReadMaxChars }) => {
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
    });

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
        fetchMode: webSearchSettings.fetchMode,
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
