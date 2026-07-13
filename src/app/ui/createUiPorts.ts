import type {
  ChatPorts,
  SettingsPorts,
} from '@pivi/obsidian-ui/ports';
import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
} from '@pivi/obsidian-ui/settings';
import { CODEX_OAUTH_PROVIDER_ID, getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { isBuiltinPiProviderId, SUPPORTED_PI_PROVIDER_IDS } from '@pivi/pivi-agent-core/auth/piProviderValidation';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { deriveProviderReadinessStatus } from '@pivi/pivi-agent-core/auth/providerReadiness';
import { isSecretStorageAvailable, MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import {
  ALL_CUSTOM_PROVIDER_KINDS,
  createDefaultCustomProviderConfig,
  type CustomProviderKind,
  FIXED_LOCAL_PROVIDER_IDS,
  getCustomProviderKindDisplayName,
  getCustomProvidersFromBag,
  isLocalCustomProviderKind,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import {
  getLogoSlugForCustomProviderKind,
  getProviderDisplayName,
  getProviderLogoSlug,
} from '@pivi/pivi-agent-core/foundation/providerLogos';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import { getObsidianToolsSettingsFromBag, resolveObsidianToolsSettings, resolveWebSearchToolsSettings } from '@pivi/pivi-agent-core/foundation/settings';
import { getEnvironmentReviewKeysForScope } from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';
import { parseEnvironmentVariables } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import { notifyVaultSkillsChanged } from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';

import type {
  PiviChatHost,
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';
import { isOfficialObsidianCliEnabled } from '@/app/hostPlatform';
import { t as appT } from '@/app/i18n';

import {
  pickDirectoryPath,
  validateDirectoryPath,
} from './externalDirectory';
import {
  getHotkeyForCommand,
  openHotkeySettings,
  SETTINGS_HOTKEY_ROWS,
} from './settingsHotkeys';

/** Chat ports take an explicit workspace; UI types stay on narrow `PiviChatHost`. */
function requireWorkspace(workspace: PiviPluginWorkspace | null): PiviPluginWorkspace {
  if (!workspace) {
    throw new Error('Pivi workspace services are not initialized.');
  }
  return workspace;
}

function removeEnvVar(envStr: string, name: string): string {
  const env = parseEnvironmentVariables(envStr);
  if (!(name in env)) {
    return envStr;
  }
  delete env[name];
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function normalizeMaxConcurrentSubagents(
  value: number,
): SettingsSubagentsSnapshot['maxConcurrentSubagents'] {
  switch (value) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 8:
      return value;
    default:
      return 2;
  }
}

export function createChatUiPorts(
  host: PiviChatHost,
  workspace: PiviPluginWorkspace | null,
): ChatPorts {
  const ws = () => requireWorkspace(workspace);
  return {
    runtime: {
      createChatService: () => host.createChatService(),
      createAuxQueryRunner: () => host.createAuxQueryRunner(),
    },
    sessions: {
      listSessions: () => host.getSessionList(),
      getOpenSession: (id) => host.getOpenSessionById(id),
      createSession: (options) => host.createOpenSession(options),
      openSessionFile: (sessionFile, leafId) => host.openSessionByFile(sessionFile, leafId),
      deleteSession: (id) => host.deleteSession(id),
      renameSession: (id, title, titleSource) => host.renameSession(id, title, titleSource),
      updateSession: (id, updates) => host.updateSession(id, updates),
      listSessionLeaves: (sessionFile) => host.listSessionLeaves(sessionFile),
      forkSession: (openSession, atEntryId) => host.forkSessionAt(openSession, atEntryId),
    },
    catalog: {
      listMcpServers: () => ws().mcpServerManager.getServers(),
      listContextSavingMcpServers: () => ws().mcpServerManager.getContextSavingServers(),
      listMcpTools: (serverName) => ws().mcpToolProvider.listTools(serverName),
      listSkills: () => ws().skillProvider.listSkills(),
      listSlashEntries: (includeBuiltIns) => (
        ws().slashCommandCatalog.listDropdownEntries({ includeBuiltIns })
      ),
      getSlashDropdownConfig: () => ws().slashCommandCatalog.getDropdownConfig(),
      refreshSlashCatalog: () => ws().slashCommandCatalog.refresh(),
    },
    models: {
      getReadinessProvider: () => ws().modelReadinessProvider ?? null,
    },
  };
}

export function createSettingsUiPorts(host: PiviSettingsHost): SettingsPorts {
  const uiFacades = host.getUiFacades();
  const snapshot = () => {
    const settings = uiFacades.getSettingsSnapshot(host.settings);
    const subagents = getSubagentRuntimeSettingsFromBag(settings);
    return {
      general: {
        locale: settings.locale,
        chatViewPlacement: settings.chatViewPlacement,
        tabBarPosition: settings.tabBarPosition ?? 'input',
        enableAutoScroll: settings.enableAutoScroll ?? true,
        deferMathRenderingDuringStreaming: settings.deferMathRenderingDuringStreaming ?? true,
        enableAutoTitleGeneration: settings.enableAutoTitleGeneration,
        autoCompact: settings.enableAutoCompact,
        autoCompactThresholdPercent: Math.round((settings.autoCompactThresholdRatio ?? 0.9) * 100),
        autoCompactKeepRecentTokens: settings.autoCompactKeepRecentTokens ?? 20_000,
        userName: settings.userName,
        excludedTags: settings.excludedTags,
        requireCommandOrControlEnterToSend: settings.requireCommandOrControlEnterToSend ?? false,
        keyboardNavigation: {
          scrollUpKey: host.settings.keyboardNavigation.scrollUpKey,
          scrollDownKey: host.settings.keyboardNavigation.scrollDownKey,
          focusInputKey: host.settings.keyboardNavigation.focusInputKey,
        },
      },
      subagents: {
        enabled: subagents.enabled,
        allowBackground: subagents.allowBackground,
        maxConcurrentSubagents: normalizeMaxConcurrentSubagents(subagents.maxConcurrentSubagents),
      },
    };
  };
  const saveGeneral = async (patch: Partial<SettingsGeneralSnapshot>): Promise<void> => {
    const current = snapshot().general;
    const next = { ...current, ...patch };
    host.settings.locale = next.locale;
    host.settings.chatViewPlacement = next.chatViewPlacement;
    host.settings.tabBarPosition = next.tabBarPosition;
    host.settings.enableAutoScroll = next.enableAutoScroll;
    host.settings.deferMathRenderingDuringStreaming = next.deferMathRenderingDuringStreaming;
    host.settings.enableAutoTitleGeneration = next.enableAutoTitleGeneration;
    host.settings.enableAutoCompact = next.autoCompact;
    host.settings.autoCompactThresholdRatio = next.autoCompactThresholdPercent / 100;
    host.settings.autoCompactKeepRecentTokens = next.autoCompactKeepRecentTokens;
    host.settings.userName = next.userName;
    host.settings.excludedTags = [...next.excludedTags];
    host.settings.requireCommandOrControlEnterToSend = next.requireCommandOrControlEnterToSend;
    host.settings.keyboardNavigation = {
      scrollUpKey: next.keyboardNavigation.scrollUpKey,
      scrollDownKey: next.keyboardNavigation.scrollDownKey,
      focusInputKey: next.keyboardNavigation.focusInputKey,
    };
    await host.saveSettings();
  };
  const saveSubagents = async (patch: Partial<SettingsSubagentsSnapshot>): Promise<void> => {
    const current = getSubagentRuntimeSettingsFromBag(host.settings);
    host.settings.agentSettings.subagents = { ...current, ...patch };
    await host.saveSettings();
  };
  return {
    complex: {
      models: {
        codexProviderId: CODEX_OAUTH_PROVIDER_ID,
        bootstrap() {
          const secretStorage = host.app.secretStorage;
          const keychainAvailable = isSecretStorageAvailable(secretStorage);
          const piSettings = getPiAgentSettings(host.settings);
          if (keychainAvailable) {
            const credentialStore = host.getPiWorkspace()?.credentialStore ?? null;
            const customIds = new Set(piSettings.customProviders.map(provider => provider.id));
            const synced = uiFacades.migrateProviderCredentialsToKeychain(
              secretStorage,
              [...new Set([...piSettings.addedProviders, ...(credentialStore?.listProviderIdsSync() ?? [])])],
              piSettings.environmentVariables,
            );
            const supportedAddedProviders = [
              ...new Set([
                ...synced.addedProviders.filter(id => isBuiltinPiProviderId(id) || customIds.has(id)),
                ...piSettings.addedProviders.filter(id => customIds.has(id)),
              ]),
            ];
            const changed = synced.changed
              || supportedAddedProviders.length !== piSettings.addedProviders.length
              || supportedAddedProviders.some((id, index) => id !== piSettings.addedProviders[index])
              || synced.environmentVariables !== piSettings.environmentVariables;
            if (changed) {
              updatePiAgentSettings(host.settings, {
                addedProviders: supportedAddedProviders,
                environmentVariables: synced.environmentVariables,
              });
              void host.saveSettings();
            }
          }
          uiFacades.syncCustomProviders(host.settings);
          return { keychainAvailable, minKeychainVersion: MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN };
        },
        getSettings: () => getPiAgentSettings(host.settings),
        async saveSettings(patch) {
          updatePiAgentSettings(host.settings, patch);
          uiFacades.syncCustomProviders(host.settings);
          await host.saveSettings();
          for (const view of host.getAllViews()) view.refreshModelSelector();
        },
        getProviderDisplayName(providerId) {
          const custom = getCustomProvidersFromBag(host.settings).find(provider => provider.id === providerId);
          return custom?.name ?? getProviderDisplayName(providerId);
        },
        getProviderLogoSlug(providerId) {
          const custom = getCustomProvidersFromBag(host.settings).find(provider => provider.id === providerId);
          if (custom) {
            return getLogoSlugForCustomProviderKind(custom.kind) ?? getProviderLogoSlug(providerId);
          }
          return getProviderLogoSlug(providerId);
        },
        getReadiness(providerId) {
          const workspace = host.getPiWorkspace();
          const piSettings = getPiAgentSettings(host.settings);
          const custom = piSettings.customProviders.find(provider => provider.id === providerId);
          const allowKeyless = !!custom && custom.apiKeyRequired === false;
          const codexConnected = providerId === CODEX_OAUTH_PROVIDER_ID
            ? (workspace?.providerOAuth?.hasCodexAuth() ?? false)
            : false;
          return deriveProviderReadinessStatus({
            providerId,
            piSettings,
            credential: workspace?.credentialStore?.readSync(providerId),
            codexConnected,
            modelCount: uiFacades.listModelsForProvider(providerId).length,
            allowKeyless,
          }).kind;
        },
        getCredentialKind(providerId) {
          const credential = host.getPiWorkspace()?.credentialStore?.readSync(providerId);
          if (credential?.type === 'api_key') return 'api_key';
          if (credential?.type === 'oauth') return 'oauth';
          return null;
        },
        getProviderEnvInfo(providerId) {
          const info = getProviderEnvVarNames(providerId);
          return info.oauthVar ? { apiKeyVar: info.apiKeyVar, oauthVar: info.oauthVar } : { apiKeyVar: info.apiKeyVar };
        },
        getSecretId: providerId => getPiAiCredentialSecretId(providerId),
        async setApiKey(providerId, key) {
          const store = requireWorkspace(host.getPiWorkspace()).credentialStore;
          if (!store) throw new Error('Provider credential storage is unavailable.');
          await store.modify(providerId, () => Promise.resolve({ type: 'api_key', key }));
          const piSettings = getPiAgentSettings(host.settings);
          const environmentVariables = removeEnvVar(piSettings.environmentVariables, getProviderEnvVarNames(providerId).apiKeyVar);
          if (environmentVariables !== piSettings.environmentVariables) {
            updatePiAgentSettings(host.settings, { environmentVariables });
          }
          await host.saveSettings();
        },
        async setOauthToken(providerId, token) {
          const store = requireWorkspace(host.getPiWorkspace()).credentialStore;
          if (!store) throw new Error('Provider credential storage is unavailable.');
          await store.modify(providerId, () => Promise.resolve({
            type: 'oauth',
            access: token,
            refresh: '',
            expires: Number.MAX_SAFE_INTEGER,
          }));
          const info = getProviderEnvVarNames(providerId);
          if (info.oauthVar) {
            const piSettings = getPiAgentSettings(host.settings);
            const environmentVariables = removeEnvVar(piSettings.environmentVariables, info.oauthVar);
            if (environmentVariables !== piSettings.environmentVariables) {
              updatePiAgentSettings(host.settings, { environmentVariables });
            }
          }
          await host.saveSettings();
        },
        async clearCredential(providerId) {
          await requireWorkspace(host.getPiWorkspace()).credentialStore?.delete(providerId);
        },
        hasCodexAuth: () => requireWorkspace(host.getPiWorkspace()).providerOAuth?.hasCodexAuth() ?? false,
        async loginCodex(onProgress) {
          const providerOAuth = requireWorkspace(host.getPiWorkspace()).providerOAuth;
          if (!providerOAuth) throw new Error('Provider OAuth is unavailable.');
          await providerOAuth.loginCodex(onProgress);
          for (const view of host.getAllViews()) view.invalidateSlashCommandCaches();
        },
        logoutCodex() {
          requireWorkspace(host.getPiWorkspace()).providerOAuth?.logoutCodex();
          for (const view of host.getAllViews()) view.invalidateSlashCommandCaches();
        },
        listAddableBuiltinProviders() {
          const added = new Set(getPiAgentSettings(host.settings).addedProviders);
          return [...SUPPORTED_PI_PROVIDER_IDS]
            .sort()
            .filter(id => !added.has(id))
            .map(id => ({ id, name: getProviderDisplayName(id), logoSlug: getProviderLogoSlug(id) }));
        },
        listAddableLocalKinds() {
          const added = new Set(getPiAgentSettings(host.settings).addedProviders);
          return ALL_CUSTOM_PROVIDER_KINDS
            .filter(kind => isLocalCustomProviderKind(kind))
            .filter(kind => !added.has(FIXED_LOCAL_PROVIDER_IDS[kind as keyof typeof FIXED_LOCAL_PROVIDER_IDS]))
            .map(kind => ({ kind, name: getCustomProviderKindDisplayName(kind), logoSlug: getLogoSlugForCustomProviderKind(kind) }));
        },
        listCustomKinds() {
          return ALL_CUSTOM_PROVIDER_KINDS
            .filter(kind => !isLocalCustomProviderKind(kind))
            .map(kind => ({ kind, name: getCustomProviderKindDisplayName(kind), logoSlug: getLogoSlugForCustomProviderKind(kind) }));
        },
        async addBuiltinProvider(providerId) {
          const piSettings = getPiAgentSettings(host.settings);
          if (!providerId || piSettings.addedProviders.includes(providerId)) return;
          updatePiAgentSettings(host.settings, { addedProviders: [...piSettings.addedProviders, providerId] });
          await host.saveSettings();
          for (const view of host.getAllViews()) view.refreshModelSelector();
        },
        async addCustomKind(kind) {
          const piSettings = getPiAgentSettings(host.settings);
          const existingIds = [...piSettings.addedProviders, ...piSettings.customProviders.map(provider => provider.id)];
          const config = createDefaultCustomProviderConfig(kind as CustomProviderKind, existingIds);
          if (!piSettings.addedProviders.includes(config.id)) {
            updatePiAgentSettings(host.settings, {
              customProviders: [...piSettings.customProviders, config],
              addedProviders: [...piSettings.addedProviders, config.id],
            });
            uiFacades.syncCustomProviders(host.settings);
            await host.saveSettings();
            for (const view of host.getAllViews()) view.refreshModelSelector();
          }
          return config.id;
        },
        async removeProvider(providerId) {
          const piSettings = getPiAgentSettings(host.settings);
          updatePiAgentSettings(host.settings, {
            addedProviders: piSettings.addedProviders.filter(id => id !== providerId),
            visibleModels: piSettings.visibleModels.filter(model => !model.startsWith(`${providerId}/`)),
            customProviders: piSettings.customProviders.filter(provider => provider.id !== providerId),
          });
          uiFacades.syncCustomProviders(host.settings);
          await host.saveSettings();
          for (const view of host.getAllViews()) view.refreshModelSelector();
        },
        async testProvider(providerId) {
          const readiness = requireWorkspace(host.getPiWorkspace()).modelReadinessProvider;
          if (!readiness.testProvider) {
            return { ok: false, detail: appT('settings.modelsTab.readinessProviderUnavailable') };
          }
          return readiness.testProvider(providerId, host.settings);
        },
        async patchCustomProvider(providerId, patch) {
          const piSettings = getPiAgentSettings(host.settings);
          const customProviders = piSettings.customProviders.map(provider =>
            provider.id === providerId ? { ...provider, ...patch } : provider,
          );
          updatePiAgentSettings(host.settings, { customProviders });
          uiFacades.syncCustomProviders(host.settings);
          await host.saveSettings();
        },
        async fetchCustomProviderModels(providerId) {
          uiFacades.syncCustomProviders(host.settings);
          const result = await uiFacades.fetchCustomProviderModels(providerId, host.settings);
          await host.saveSettings();
          for (const view of host.getAllViews()) view.refreshModelSelector();
          return result;
        },
        notify: message => host.notify?.(message),
      },
      skills: {
        list: () => {
          const vaultPath = host.getVaultPath();
          return vaultPath ? new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).list() : [];
        },
        async listRemote(source) {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          return new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).listRemoteSkills(source);
        },
        async install(source, skillNames) {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          await new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).installFromSource(source, { skillNames: skillNames ? [...skillNames] : undefined });
          await notifyVaultSkillsChanged(host);
        },
        async setDisabled(folderName, disabled) {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).setSkillDisabled(folderName, disabled);
          await notifyVaultSkillsChanged(host);
        },
        async remove(folderName) {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).remove(folderName);
          await notifyVaultSkillsChanged(host);
        },
        async updateAll() {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          await new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).updateAll();
          await notifyVaultSkillsChanged(host);
        },
        async update(skillName, folderName) {
          const vaultPath = host.getVaultPath();
          if (!vaultPath) throw new Error('Vault path is unavailable.');
          await new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).updateSkill(skillName, folderName);
          await notifyVaultSkillsChanged(host);
        },
      },
      tools: {
        getSettings: () => {
          const settings = getObsidianToolsSettingsFromBag(host.settings);
          return {
            allowBash: settings.allowBash,
            allowExternalRead: settings.allowExternalRead,
            bashAllowlist: settings.bashAllowlist ?? [],
            externalReadDirectories: settings.externalReadDirectories,
            disabledTools: settings.disabledTools ?? [],
            officialCliEnabled: isOfficialObsidianCliEnabled(),
          };
        },
        chooseExternalDirectory: () => pickDirectoryPath(),
        validateExternalDirectory: path => Promise.resolve(validateDirectoryPath(path)),
        async saveSettings(patch) {
          const current = resolveObsidianToolsSettings(host.settings.agentSettings.obsidianTools);
          if (patch.externalReadDirectories) {
            for (const directory of patch.externalReadDirectories) {
              const validation = validateDirectoryPath(directory);
              if (!validation.valid) throw new Error(validation.error ?? 'Invalid external directory.');
            }
          }
          const bashAllowlist = patch.bashAllowlist
            ? [...new Set(patch.bashAllowlist.map(entry => entry.trim()).filter(Boolean))]
            : [...current.bashAllowlist];
          host.settings.agentSettings.obsidianTools = {
            ...current,
            ...patch,
            externalReadDirectories: patch.externalReadDirectories ? [...patch.externalReadDirectories] : current.externalReadDirectories,
            bashAllowlist,
            disabledTools: patch.disabledTools ? [...patch.disabledTools] : current.disabledTools,
          };
          await host.saveSettings();
          const tabManager = host.getView()?.getTabManager();
          if (tabManager) {
            try {
              await tabManager.broadcastToAllTabs(async service => {
                if (service.syncSystemPrompt) await service.syncSystemPrompt();
                else await service.ensureReady({ force: true });
              });
            } catch {
              // Persisted tool changes apply during the next session initialization.
            }
          }
          if (patch.externalReadDirectories) {
            for (const view of host.getAllViews()) view.getTabManager()?.syncPinnedExternalContextPaths([...patch.externalReadDirectories]);
          }
        },
      },
      webSearch: {
        getSettings: () => {
          const settings = resolveWebSearchToolsSettings(host.settings.agentSettings.webSearchTools);
          return { searchProvider: settings.searchProvider, fetchProvider: settings.fetchProvider };
        },
        async saveSettings(patch) {
          const current = resolveWebSearchToolsSettings(host.settings.agentSettings.webSearchTools);
          host.settings.agentSettings.webSearchTools = { ...current, ...patch } as typeof current;
          await host.saveSettings();
        },
        hasCredential: providerId => Boolean(requireWorkspace(host.getPiWorkspace()).webSearchCredentialStore?.readSync(providerId as never)),
        writeCredential: (providerId, key) => requireWorkspace(host.getPiWorkspace()).webSearchCredentialStore?.writeSync(providerId as never, key),
        clearCredential: providerId => requireWorkspace(host.getPiWorkspace()).webSearchCredentialStore?.clearSync(providerId as never),
      },
      runtime: {
        async refreshPrompt() {
          const tabManager = host.getView()?.getTabManager();
          if (!tabManager) return;
          try {
            await tabManager.broadcastToAllTabs(async service => {
              if (service.syncSystemPrompt) await service.syncSystemPrompt();
              else await service.ensureReady({ force: true });
            });
          } catch {
            // A subsequent session initialization applies the persisted settings.
          }
        },
        refreshModelSelectors: () => {
          for (const view of host.getAllViews()) view.refreshModelSelector();
        },
      },
      commands: {
        refresh: () => requireWorkspace(host.getPiWorkspace()).slashCommandCatalog.refresh(),
        listVaultEntries: () => requireWorkspace(host.getPiWorkspace()).slashCommandCatalog.listVaultEntries(),
        listDropdownEntries: () => requireWorkspace(host.getPiWorkspace()).slashCommandCatalog.listDropdownEntries({ includeBuiltIns: true }),
        async saveVaultEntry(entry) {
          await requireWorkspace(host.getPiWorkspace()).slashCommandCatalog.saveVaultEntry(entry);
          for (const view of host.getAllViews()) view.invalidateSlashCommandCaches();
        },
        async deleteVaultEntry(entry) {
          await requireWorkspace(host.getPiWorkspace()).slashCommandCatalog.deleteVaultEntry(entry);
          for (const view of host.getAllViews()) view.invalidateSlashCommandCaches();
        },
      },
      mcp: {
        load: () => requireWorkspace(host.getPiWorkspace()).mcpStorage.load(),
        async save(servers) {
          const workspace = requireWorkspace(host.getPiWorkspace());
          await workspace.mcpStorage.save([...servers]);
          workspace.mcpToolProvider.invalidateAll?.();
          for (const view of host.getAllViews()) {
            await view.getTabManager()?.broadcastToAllTabs(service => service.reloadMcpServers());
            view.invalidateSlashCommandCaches();
          }
          // Warm slash + provider caches without blocking the settings UI.
          void (async () => {
            try {
              await workspace.mcpToolProvider.prefetchEnabledServers?.();
            } catch {
              // Best-effort warmup; first slash open or turn will retry.
            }
            for (const view of host.getAllViews()) {
              view.prefetchSlashCommandCaches();
            }
          })();
        },
        test: server => requireWorkspace(host.getPiWorkspace()).mcpServerTester.testServer(server),
        getAuthStatus: async server => (await requireWorkspace(host.getPiWorkspace()).mcpOAuth?.getAuthStatus(server)) ?? null,
        authenticate: async server => (await requireWorkspace(host.getPiWorkspace()).mcpOAuth?.authenticate(server)) ?? null,
        logout: async serverName => { await requireWorkspace(host.getPiWorkspace()).mcpOAuth?.logout(serverName); },
        async reload() {
          const workspace = requireWorkspace(host.getPiWorkspace());
          workspace.mcpToolProvider.invalidateAll?.();
          for (const view of host.getAllViews()) {
            await view.getTabManager()?.broadcastToAllTabs(service => service.reloadMcpServers());
            view.invalidateSlashCommandCaches();
          }
          void (async () => {
            try {
              await workspace.mcpToolProvider.prefetchEnabledServers?.();
            } catch {
              // Best-effort warmup.
            }
            for (const view of host.getAllViews()) {
              view.prefetchSlashCommandCaches();
            }
          })();
        },
      },
    },
    snapshot: { getSnapshot: snapshot },
    actions: {
      saveGeneral,
      saveSubagents,
      purgeDeletedSessionFiles: () => host.purgeDeletedSessionFiles(),
      openStyleSettings: () => host.openStyleSettings(),
      setupNoteToolbarIntegration: (itemStyle) => host.setupNoteToolbarIntegration(itemStyle),
    },
    persistence: {
      getSettingsSnapshot: () => uiFacades.getSettingsSnapshot(host.settings),
      async commitSettingsSnapshot(snapshot) {
        uiFacades.commitSettingsSnapshot(host.settings, snapshot);
        await host.saveSettings();
      },
    },
    environment: {
      getActiveEnvironmentVariables: () => host.getActiveEnvironmentVariables(),
      getEnvironmentVariables: (scope) => host.getEnvironmentVariablesForScope(scope),
      applyEnvironmentVariables: (scope, envText) => host.applyEnvironmentVariables(scope, envText),
      applyEnvironmentVariablesBatch: (updates) => host.applyEnvironmentVariablesBatch(updates),
      getReviewKeys: (scope, envText) => getEnvironmentReviewKeysForScope(envText, scope),
    },
    hotkeys: {
      listHotkeys: () => SETTINGS_HOTKEY_ROWS.map((row) => ({
        commandId: row.commandId,
        labelKey: row.labelKey,
        hotkey: getHotkeyForCommand(host.app, row.commandId),
      })),
      openHotkeySettings: () => openHotkeySettings(host.app),
    },
    catalog: {
      listModelsForProvider: (providerId) => uiFacades.listModelsForProvider(providerId),
      syncCustomProviders: (snapshot) => uiFacades.syncCustomProviders(snapshot),
      fetchCustomProviderModels: (providerId, snapshot) => (
        uiFacades.fetchCustomProviderModels(providerId, snapshot)
      ),
    },
  };
}
