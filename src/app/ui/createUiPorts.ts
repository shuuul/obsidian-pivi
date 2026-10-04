import type {
  ChatPorts,
  ChatSessionPort,
  ChatSettingsSnapshot,
} from '@pivi/agent/runtime/chatPorts';
import { getRuntimeEnvironmentText } from '@pivi/agent/settings/agentEnvironment';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { getObsidianToolsSettingsFromBag } from '@pivi/agent/settings/types';

import type { PiviChatCompositionHost, PiviPluginWorkspace } from '@/app/hostContracts';
import { mergeExternalDirectoryPermissions } from '@/app/settings/piviSettingsCodec';

import {
  appendBashPermissions as persistBashPermissions,
  appendExternalReadDirectory as persistExternalReadDirectory,
  appendObsidianCommandPermission as persistObsidianCommandPermission,
  cloneChatCustomProviders,
  requireWorkspace,
} from './createUiPortHelpers';
export function createChatUiPorts(
  host: PiviChatCompositionHost,
  sessions: ChatSessionPort,
  workspace: PiviPluginWorkspace | null,
): ChatPorts {
  const ws = () => requireWorkspace(workspace);
  const uiFacades = host.getUiFacades();
  const chatConfig = uiFacades.chatUIConfig;
  const toChatConfigSettings = (
    settings: ChatSettingsSnapshot,
  ): Record<string, unknown> => ({
    model: settings.model,
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
      thinkingLevel: projected.thinkingLevel,
      customContextLimits: { ...projected.customContextLimits },
      enableAutoScroll: projected.enableAutoScroll ?? true,
      deferMathRenderingDuringStreaming: projected.deferMathRenderingDuringStreaming ?? true,
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
      obsidianCommandPermissions: [...tools.commandAllowlist],
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
    sessions,
    catalog: {
      listMcpServers: () => ws().mcpServerManager.getServers(),
      listContextSavingMcpServers: () => ws().mcpServerManager.getContextSavingServers(),
      listMcpTools: (serverName) => ws().mcpToolProvider.listTools(serverName),
      listMcpInventoryTools: (serverName) => {
        const provider = ws().mcpToolProvider;
        return provider.listInventoryTools?.(serverName) ?? provider.listTools(serverName);
      },
      listSkills: () => ws().skillProvider.listSkills(),
      listSlashEntries: () => ws().slashCommandCatalog.listDropdownEntries(),
      getSlashDropdownConfig: () => ws().slashCommandCatalog.getDropdownConfig(),
    },
    models: {
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
      applyReasoningSelection: (model, value, settings) => {
        applyChatConfigMutation(settings, (configSettings) => {
          chatConfig.applyReasoningSelection?.(model, value, configSettings);
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
          // Keep the grant records aligned; saving persists these, not the path list.
          externalDirectoryPermissions: mergeExternalDirectoryPermissions(
            current.externalDirectoryPermissions,
            paths,
          ),
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
      async appendObsidianCommandPermission(commandId) {
        await persistObsidianCommandPermission(host, commandId);
      },
    },
  };
}
