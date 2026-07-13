import type { SettingsPorts } from '@pivi/obsidian-react/ports';
import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
} from '@pivi/obsidian-react/settings';
import type { OpenSessionState, SessionSummary } from '@pivi/pivi-agent-core/foundation';
import { getPiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import { getObsidianToolsSettingsFromBag, resolveObsidianToolsSettings, resolveWebSearchToolsSettings } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getEnvironmentReviewKeysForScope,
  getRuntimeEnvironmentText,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';
import type {
  ChatPorts,
  ChatSettingsSnapshot,
} from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { LeafSummary } from '@pivi/pivi-agent-core/session';
import { notifyVaultSkillsChanged } from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';

import type {
  PiviChatCompositionHost,
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';
import { isOfficialObsidianCliEnabled } from '@/app/hostPlatform';

import { createMcpSettingsPort } from './createMcpSettingsPorts';
import { createSettingsModelsPort } from './createSettingsModelsPort';
import {
  normalizeMaxConcurrentSubagents,
  requireWorkspace,
} from './createUiPortHelpers';
import {
  pickDirectoryPath,
  validateDirectoryPath,
} from './externalDirectory';
import {
  getHotkeyForCommand,
  openHotkeySettings,
  SETTINGS_HOTKEY_ROWS,
} from './settingsHotkeys';

/** Composition-only plugin capabilities adapted into core-owned chat ports. */
export type ChatUiCompositionHost = PiviChatCompositionHost & {
  createChatService(): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
  getSessionList(): SessionSummary[];
  getOpenSessionSync(id: string): OpenSessionState | null;
  getOpenSessionById(id: string): Promise<OpenSessionState | null>;
  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string, leafId?: string | null): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  listSessionLeaves(sessionFile: string): Promise<LeafSummary[]>;
  forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
};

function cloneChatCustomProviders(
  providers: ChatSettingsSnapshot['modelCatalog']['customProviders'],
): ChatSettingsSnapshot['modelCatalog']['customProviders'] {
  return providers.map((provider) => ({
    ...provider,
    ...(provider.headers ? { headers: { ...provider.headers } } : {}),
    models: provider.models.map((model) => ({ ...model })),
  }));
}

export function createChatUiPorts(
  host: ChatUiCompositionHost,
  workspace: PiviPluginWorkspace | null,
): ChatPorts {
  const ws = () => requireWorkspace(workspace);
  const uiFacades = host.getUiFacades();
  const chatConfig = uiFacades.chatUIConfig;
  const toChatConfigSettings = (
    settings: ChatSettingsSnapshot,
  ): Record<string, unknown> => ({
    model: settings.model,
    thinkingBudget: settings.thinkingBudget,
    thinkingLevel: settings.thinkingLevel,
    customContextLimits: { ...settings.customContextLimits },
    agentSettings: {
      addedProviders: [...settings.modelCatalog.addedProviders],
      disabledProviders: [...settings.modelCatalog.disabledProviders],
      visibleModels: [...settings.modelCatalog.visibleModels],
      customProviders: cloneChatCustomProviders(settings.modelCatalog.customProviders),
      environmentVariables: settings.environmentVariables,
    },
  });
  const applyChatConfigMutation = (
    settings: ChatSettingsSnapshot,
    mutate: (configSettings: Record<string, unknown>) => void,
  ): void => {
    const configSettings = toChatConfigSettings(settings);
    mutate(configSettings);
    if (typeof configSettings.model === 'string') {
      settings.model = configSettings.model;
    }
    if (typeof configSettings.thinkingBudget === 'string') {
      settings.thinkingBudget = configSettings.thinkingBudget;
    }
    if (typeof configSettings.thinkingLevel === 'string') {
      settings.thinkingLevel = configSettings.thinkingLevel;
    }
  };
  const getChatSettingsSnapshot = (): ChatSettingsSnapshot => {
    const projected = uiFacades.getSettingsSnapshot(host.settings);
    const modelCatalog = getPiAgentSettings(projected);
    const tools = getObsidianToolsSettingsFromBag(projected);
    return {
      model: projected.model,
      thinkingBudget: projected.thinkingBudget,
      thinkingLevel: projected.thinkingLevel,
      customContextLimits: { ...projected.customContextLimits },
      enableAutoScroll: projected.enableAutoScroll ?? true,
      enableAutoTitleGeneration: projected.enableAutoTitleGeneration,
      titleGenerationModel: projected.titleGenerationModel,
      userName: projected.userName,
      excludedTags: [...projected.excludedTags],
      keyboardNavigation: { ...projected.keyboardNavigation },
      requireCommandOrControlEnterToSend:
        projected.requireCommandOrControlEnterToSend ?? false,
      environmentVariables: getRuntimeEnvironmentText(projected),
      externalReadDirectories: [...tools.externalReadDirectories],
      hiddenSlashCommands: [...projected.hiddenSlashCommands],
      modelCatalog: {
        addedProviders: [...modelCatalog.addedProviders],
        disabledProviders: [...modelCatalog.disabledProviders],
        visibleModels: [...modelCatalog.visibleModels],
        customProviders: cloneChatCustomProviders(modelCatalog.customProviders),
      },
    };
  };
  return {
    runtime: {
      createChatService: () => host.createChatService(),
      createAuxQueryRunner: () => host.createAuxQueryRunner(),
    },
    sessions: {
      listSessions: () => host.getSessionList(),
      findOpenSession: (id) => host.getOpenSessionSync(id),
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
      getModelOptions: (settings) => chatConfig.getModelOptions(toChatConfigSettings(settings)),
      isAdaptiveReasoningModel: (model, settings) => (
        chatConfig.isAdaptiveReasoningModel(model, toChatConfigSettings(settings))
      ),
      getReasoningOptions: (model, settings) => (
        chatConfig.getReasoningOptions(model, toChatConfigSettings(settings))
      ),
      getDefaultReasoningValue: (model, settings) => (
        chatConfig.getDefaultReasoningValue(model, toChatConfigSettings(settings))
      ),
      getContextWindowSize: (model, customLimits) => (
        chatConfig.getContextWindowSize(model, customLimits)
      ),
      applyModelDefaults: (model, settings) => {
        applyChatConfigMutation(settings, (configSettings) => {
          chatConfig.applyModelDefaults(model, configSettings);
        });
      },
      prepareModelMetadata: (model) => (
        chatConfig.prepareModelMetadata?.(model, host.settings, {
          host: host.getAgentHostContext(),
        }) ?? Promise.resolve()
      ),
      applyReasoningSelection: (model, value, settings) => {
        applyChatConfigMutation(settings, (configSettings) => {
          chatConfig.applyReasoningSelection?.(model, value, configSettings);
        });
      },
      getModeSelector: (settings) => (
        chatConfig.getModeSelector?.(toChatConfigSettings(settings)) ?? null
      ),
      applyModeSelection: (value, settings) => {
        applyChatConfigMutation(settings, (configSettings) => {
          chatConfig.applyModeSelection?.(value, configSettings);
        });
      },
    },
    settings: {
      getSettingsSnapshot: getChatSettingsSnapshot,
      async commitSettingsSnapshot(snapshot) {
        const current = uiFacades.getSettingsSnapshot(host.settings);
        uiFacades.commitSettingsSnapshot(host.settings, {
          ...current,
          model: snapshot.model,
          thinkingBudget: snapshot.thinkingBudget,
          thinkingLevel: snapshot.thinkingLevel,
          customContextLimits: { ...snapshot.customContextLimits },
        });
        await host.saveSettings();
      },
      async setPinnedExternalReadDirectories(paths) {
        const current = getObsidianToolsSettingsFromBag(host.settings);
        host.settings.agentSettings.obsidianTools = {
          ...current,
          externalReadDirectories: [...paths],
        };
        await host.saveSettings();
        for (const view of host.getAllViews()) {
          view.getChatHandle()?.maintenance.syncExternalReadDirectories(paths);
        }
      },
    },
  };
}

export function createSettingsUiPorts(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace | null,
): SettingsPorts {
  const ws = requireWorkspace(workspace);
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
      models: createSettingsModelsPort(host, uiFacades, ws),
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
          for (const view of host.getAllViews()) {
            await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
          }
          if (patch.externalReadDirectories) {
            for (const view of host.getAllViews()) {
              view.getChatHandle()?.maintenance
                .syncExternalReadDirectories(patch.externalReadDirectories);
            }
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
        hasCredential: providerId => Boolean(ws.webSearchCredentialStore?.readSync(providerId as never)),
        writeCredential: (providerId, key) => ws.webSearchCredentialStore?.writeSync(providerId as never, key),
        clearCredential: providerId => ws.webSearchCredentialStore?.clearSync(providerId as never),
      },
      runtime: {
        async refreshPrompt() {
          for (const view of host.getAllViews()) {
            await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
          }
        },
        refreshModelSelectors: () => {
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.refreshModelPresentation();
          }
        },
      },
      commands: {
        refresh: () => ws.slashCommandCatalog.refresh(),
        listVaultEntries: () => ws.slashCommandCatalog.listVaultEntries(),
        listDropdownEntries: () => ws.slashCommandCatalog.listDropdownEntries({ includeBuiltIns: true }),
        async saveVaultEntry(entry) {
          await ws.slashCommandCatalog.saveVaultEntry(entry);
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.invalidateSlashCatalog();
          }
        },
        async deleteVaultEntry(entry) {
          await ws.slashCommandCatalog.deleteVaultEntry(entry);
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.invalidateSlashCatalog();
          }
        },
      },
      mcp: createMcpSettingsPort(host, ws),
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
