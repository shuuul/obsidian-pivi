import type {
  ChatPorts,
  ChatSettingsSnapshot,
} from '@pivi/agent/runtime/chatPorts';
import { getRuntimeEnvironmentText } from '@pivi/agent/settings/agentEnvironment';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { getObsidianToolsSettingsFromBag } from '@pivi/agent/settings/types';

import type { PiviPluginWorkspace } from '@/app/hostContracts';

import { type ChatUiCompositionHost, type ChatUiSessionHost } from './chatUiCompositionHost';
import {
  appendBashPermissions as persistBashPermissions,
  appendExternalReadDirectory as persistExternalReadDirectory,
  cloneChatCustomProviders,
  requireWorkspace,
} from './createUiPortHelpers';
export type { ChatUiCompositionHost, ChatUiSessionHost } from './chatUiCompositionHost';
export function createChatUiPorts(
  host: ChatUiCompositionHost,
  sessions: ChatUiSessionHost,
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
      showCacheHitRate: projected.showCacheHitRate !== false,
      showTokensPerSecond: projected.showTokensPerSecond !== false,
      enableAutoTitleGeneration: projected.enableAutoTitleGeneration,
      titleGenerationModel: projected.titleGenerationModel,
      userName: projected.userName,
      excludedTags: [...projected.excludedTags],
      requireCommandOrControlEnterToSend:
        projected.requireCommandOrControlEnterToSend ?? false,
      environmentVariables: getRuntimeEnvironmentText(projected),
      externalReadDirectories: [...tools.externalReadDirectories],
      bashPermissions: [...tools.bashPermissions],
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
      createChatService: (options) => host.createChatService(options),
      createAuxQueryRunner: () => host.createAuxQueryRunner(),
    },
    sessions: {
      listSessions: () => sessions.getSessionList(),
      findOpenSession: (id) => sessions.getOpenSessionSync(id),
      getOpenSession: (id) => sessions.getOpenSessionById(id),
      openRecent: (id, limit) => sessions.openRecentSessionMessages(id, limit),
      readOlder: (id, beforeEntryId, limit) => (
        sessions.readOlderSessionMessages(id, beforeEntryId, limit)
      ),
      createSession: (options) => sessions.createOpenSession(options),
      openSessionFile: (sessionFile) => sessions.openSessionByFile(sessionFile),
      deleteSession: (id) => sessions.deleteSession(id),
      deleteSessionFile: (file, id) => sessions.deleteSessionFile(file, id),
      discardSessionFile: (file, id) => sessions.discardSessionFile(file, id),
      abandonEmptyOwnedSession: (file, id) => sessions.abandonEmptyOwnedSession(file, id),
      renameSession: (id, title, titleSource) => sessions.renameSession(id, title, titleSource),
      updateSession: (id, updates) => sessions.updateSession(id, updates),
      forkSession: (openSession, atEntryId) => sessions.forkSessionAt(openSession, atEntryId),
    },
    catalog: {
      listMcpServers: () => ws().mcpServerManager.getServers(),
      listContextSavingMcpServers: () => ws().mcpServerManager.getContextSavingServers(),
      listMcpTools: (serverName) => ws().mcpToolProvider.listTools(serverName),
      listMcpInventoryTools: (serverName) => {
        const provider = ws().mcpToolProvider;
        return provider.listInventoryTools?.(serverName) ?? provider.listTools(serverName);
      },
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
      async appendBashPermissions(permissions) {
        await persistBashPermissions(host, permissions);
      },
      async appendExternalReadDirectory(directory) {
        await persistExternalReadDirectory(host, directory);
      },
    },
  };
}
