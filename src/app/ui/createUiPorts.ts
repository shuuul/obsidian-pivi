import type { OpenSessionState, SessionSummary } from '@pivi/pivi-agent-core/foundation';
import { getPiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
  resolveWebSearchToolsSettings,
  WEB_PROVIDER_CAPABILITIES,
  WEB_PROVIDER_IDS,
} from '@pivi/pivi-agent-core/foundation/settings';
import {
  getEnvironmentReviewKeysForScope,
  getRuntimeEnvironmentText,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';
import { parseEnvironmentVariables } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';
import type {
  ChatPorts,
  ChatSettingsSnapshot,
} from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { SessionMessagePage } from '@pivi/pivi-agent-core/session';
import { providerApiKeyEnvVar, TOOL_OBSIDIAN_BASH } from '@pivi/pivi-agent-core/tools';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
} from '@pivi/pivi-react/settings';
import type { ChatPerfRecorder } from '@pivi/pivi-react/store';
import { getIconIds } from 'obsidian';

import type {
  PiviChatCompositionHost,
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';

import { createMcpSettingsPort } from './createMcpSettingsPorts';
import { createSettingsModelsPort } from './createSettingsModelsPort';
import { createSettingsSkillsPort } from './createSettingsSkillsPort';
import {
  normalizeMaxConcurrentSubagents,
  requireWorkspace,
} from './createUiPortHelpers';
import {
  pickDirectoryPath,
  validateDirectoryPath,
} from './externalDirectory';
import {
  createObsidianToolRows,
  describeNoteToolbarResult,
  listObsidianIntegrationSections,
  runObsidianIntegrationAction,
} from './obsidianSettingsIntegration';
import {
  getHotkeyForCommand,
  openHotkeySettings,
  SETTINGS_HOTKEY_ROWS,
} from './settingsHotkeys';

/** Composition-only plugin capabilities adapted into core-owned chat ports. */
export type ChatUiCompositionHost = PiviChatCompositionHost & {
  getChatPerfRecorder(): ChatPerfRecorder;
  createChatService(): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
  getSessionList(): SessionSummary[];
  getOpenSessionSync(id: string): OpenSessionState | null;
  getOpenSessionById(id: string): Promise<OpenSessionState | null>;
  openRecentSessionMessages(id: string, limit: number): Promise<SessionMessagePage | null>;
  readOlderSessionMessages(
    id: string,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage | null>;
  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
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
      openRecent: (id, limit) => host.openRecentSessionMessages(id, limit),
      readOlder: (id, beforeEntryId, limit) => (
        host.readOlderSessionMessages(id, beforeEntryId, limit)
      ),
      createSession: (options) => host.createOpenSession(options),
      openSessionFile: (sessionFile) => host.openSessionByFile(sessionFile),
      deleteSession: (id) => host.deleteSession(id),
      renameSession: (id, title, titleSource) => host.renameSession(id, title, titleSource),
      updateSession: (id, updates) => host.updateSession(id, updates),
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
    if (patch.tabBarPosition !== undefined) {
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshTabBarPosition();
      }
    }
    await host.saveSettings();
  };
  const saveSubagents = async (patch: Partial<SettingsSubagentsSnapshot>): Promise<void> => {
    const current = getSubagentRuntimeSettingsFromBag(host.settings);
    host.settings.agentSettings.subagents = { ...current, ...patch };
    await host.saveSettings();
    for (const view of host.getAllViews()) {
      await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
    }
  };
  const saveToolSettings = async (patch: {
    allowBash?: boolean;
    bashAllowlist?: readonly string[];
    allowExternalRead?: boolean;
    externalReadDirectories?: readonly string[];
    disabledTools?: readonly string[];
  }): Promise<void> => {
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
      if (patch.disabledTools) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
      await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
    }
    if (patch.externalReadDirectories) {
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance
          .syncExternalReadDirectories(patch.externalReadDirectories);
      }
    }
  };
  return {
    complex: {
      models: createSettingsModelsPort(host, uiFacades, ws),
      skills: createSettingsSkillsPort(host),
      tools: {
        getSettings: () => {
          const settings = getObsidianToolsSettingsFromBag(host.settings);
          return {
            allowBash: settings.allowBash,
            allowExternalRead: settings.allowExternalRead,
            bashAllowlist: settings.bashAllowlist ?? [],
            externalReadDirectories: settings.externalReadDirectories,
          };
        },
        listToolRows: () => {
          const settings = getObsidianToolsSettingsFromBag(host.settings);
          return createObsidianToolRows(settings, ws.providerOAuth?.hasCodexAuth() ?? false);
        },
        async setToolEnabled(name, enabled) {
          if (name === TOOL_OBSIDIAN_BASH) {
            await saveToolSettings({ allowBash: enabled });
            return;
          }
          const current = getObsidianToolsSettingsFromBag(host.settings);
          const disabledTools = new Set(current.disabledTools ?? []);
          if (enabled) disabledTools.delete(name);
          else disabledTools.add(name);
          await saveToolSettings({ disabledTools: [...disabledTools].sort() });
        },
        chooseExternalDirectory: () => pickDirectoryPath(),
        validateExternalDirectory: path => Promise.resolve(validateDirectoryPath(path)),
        saveSettings: saveToolSettings,
      },
      webSearch: {
        getSettings: () => resolveWebSearchToolsSettings(host.settings.agentSettings.webSearchTools),
        listProviders: () => {
          const environmentVariables = parseEnvironmentVariables(
            host.settings.agentSettings?.environmentVariables ?? '',
          );
          return WEB_PROVIDER_IDS.map((id) => {
            const storedCredential = Boolean(ws.webSearchCredentialStore?.readSync(id));
            const environmentCredential = Boolean(environmentVariables[providerApiKeyEnvVar(id)]?.trim());
            const capabilities = WEB_PROVIDER_CAPABILITIES[id];
            return {
              id,
              ...capabilities,
              storedCredential,
              environmentCredential,
              credentialConfigured: storedCredential || environmentCredential,
            };
          });
        },
        async saveSettings(patch) {
          const current = resolveWebSearchToolsSettings(host.settings.agentSettings.webSearchTools);
          const next = resolveWebSearchToolsSettings({ ...current, ...patch });
          host.settings.agentSettings.webSearchTools = next;
          try {
            await host.saveSettings();
          } catch (error) {
            host.settings.agentSettings.webSearchTools = current;
            throw error;
          }
        },
        writeCredential(providerId, key) {
          if (!ws.webSearchCredentialStore) throw new Error('Web provider credential storage is unavailable.');
          ws.webSearchCredentialStore.writeSync(providerId, key);
        },
        clearCredential(providerId) {
          if (!ws.webSearchCredentialStore) throw new Error('Web provider credential storage is unavailable.');
          ws.webSearchCredentialStore.clearSync(providerId);
        },
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
        listIconNames: () => getIconIds(),
        listWorkspaceEntries: () => ws.slashCommandCatalog.listWorkspaceEntries(),
        listDropdownEntries: () => ws.slashCommandCatalog.listDropdownEntries({ includeBuiltIns: true }),
        async saveWorkspaceEntry(entry) {
          await ws.slashCommandCatalog.saveWorkspaceEntry(entry);
          const saved = (await ws.slashCommandCatalog.listWorkspaceEntries())
            .find(candidate => candidate.id === entry.id);
          if (!saved) {
            throw new Error(`Saved workspace command /${entry.name} was not found`);
          }
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.invalidateSlashCatalog();
          }
          return saved;
        },
        async deleteWorkspaceEntry(entry) {
          await ws.slashCommandCatalog.deleteWorkspaceEntry(entry);
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.invalidateSlashCatalog();
          }
        },
        isNoteToolbarInstalled: () => host.isNoteToolbarInstalled(),
        async setupNoteToolbar(entry) {
          const result = await host.setupWorkspaceCommandNoteToolbar(entry);
          return describeNoteToolbarResult(result);
        },
      },
      mcp: createMcpSettingsPort(host, ws),
    },
    feedback: {
      notify: message => { host.notify(message); },
    },
    snapshot: { getSnapshot: snapshot },
    actions: {
      saveGeneral,
      saveSubagents,
      purgeDeletedSessionFiles: () => host.purgeDeletedSessionFiles(),
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
    hostIntegrations: {
      listSections: async () => listObsidianIntegrationSections(
        await host.isNoteToolbarInstalled(),
      ),
      runAction: actionId => runObsidianIntegrationAction(host, actionId),
    },
  };
}
