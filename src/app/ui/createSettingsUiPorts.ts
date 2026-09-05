import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import { getEnvironmentReviewKeysForScope } from '@pivi/agent/settings/agentEnvironment';
import { parseEnvironmentVariables } from '@pivi/agent/settings/environmentText';
import {
  type EditorSelectionToolbarSettings,
  getObsidianToolsSettingsFromBag,
  getSubagentRuntimeSettingsFromBag,
  normalizeEditorSelectionToolbarSettings,
  resolveObsidianToolsSettings,
  resolveWebSearchToolsSettings,
  WEB_PROVIDER_CAPABILITIES,
  WEB_PROVIDER_IDS,
} from '@pivi/agent/settings/types';
import {
  canonicalizeBashPermissions,
  canonicalizeExternalDirectories,
  defaultCaseInsensitiveExecutables,
  enabledExternalDirectories,
  providerApiKeyEnvVar,
  TOOL_OBSIDIAN_BASH,
} from '@pivi/agent/tools';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
} from '@pivi/pivi-react/settings';
import { getIconIds } from 'obsidian';

import { getSelectionToolbarHost } from '@/app/editorSelectionToolbarRegistration';
import type {
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';
import { isPathWithinVault } from '@/app/hostPlatform';
import { t } from '@/app/i18n';
import { isNoteToolbarTextToolbarActive } from '@/app/noteToolbarIntegration';
import {
  PIVI_GITHUB_URL,
  PIVI_ISSUES_URL,
  PIVI_RELEASED_AT,
  PIVI_VERSION,
} from '@/app/pluginIdentity';

import { createMcpSettingsPort } from './createMcpSettingsPorts';
import { createSettingsModelsPort } from './createSettingsModelsPort';
import { createSettingsPromptPort } from './createSettingsPromptPort';
import { createSettingsSkillsPort } from './createSettingsSkillsPort';
import {
  invalidateSlashCatalog,
  normalizeMaxConcurrentSubagents,
  requireWorkspace,
} from './createUiPortHelpers';
import {
  pickDirectoryPath,
  validateDirectoryPath,
} from './externalDirectory';
import { listObsidianCommands } from './listObsidianCommands';
import { createMentionEditorPort } from './mentionEditor/createMentionEditorPort';
import {
  createObsidianToolRows,
  listObsidianIntegrationSections,
  runObsidianIntegrationAction,
} from './obsidianSettingsIntegration';
import {
  getHotkeyForCommand,
  openHotkeySettings,
  SETTINGS_HOTKEY_ROWS,
} from './settingsHotkeys';
const logger = new PluginLogger('UiPorts');
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
        showCacheHitRate: settings.showCacheHitRate !== false,
        showTokensPerSecond: settings.showTokensPerSecond !== false,
        enableAutoTitleGeneration: settings.enableAutoTitleGeneration,
        userName: settings.userName,
        excludedTags: settings.excludedTags,
        deletedSessionRetentionDays: settings.deletedSessionRetentionDays ?? 30,
        providerRequestDeadlines: { ...settings.providerRequestDeadlines },
        requireCommandOrControlEnterToSend: settings.requireCommandOrControlEnterToSend ?? false,
        editorSelectionToolbar: normalizeEditorSelectionToolbarSettings(
          host.settings.editorSelectionToolbar,
        ),
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
    host.settings.showCacheHitRate = next.showCacheHitRate;
    host.settings.showTokensPerSecond = next.showTokensPerSecond;
    host.settings.enableAutoTitleGeneration = next.enableAutoTitleGeneration;
    host.settings.userName = next.userName;
    host.settings.excludedTags = [...next.excludedTags];
    host.settings.deletedSessionRetentionDays = Math.max(1, Math.min(
      3650, Math.trunc(next.deletedSessionRetentionDays ?? 30),
    ));
    host.settings.providerRequestDeadlines = {
      totalMs: Math.max(0, Math.trunc(next.providerRequestDeadlines.totalMs)),
      idleMs: Math.max(0, Math.trunc(next.providerRequestDeadlines.idleMs)),
    };
    host.settings.requireCommandOrControlEnterToSend = next.requireCommandOrControlEnterToSend;
    if (
      patch.tabBarPosition !== undefined
      || patch.showCacheHitRate !== undefined
      || patch.showTokensPerSecond !== undefined
    ) {
      for (const view of host.getAllViews()) {
        const maintenance = view.getChatHandle()?.maintenance;
        if (patch.tabBarPosition !== undefined) maintenance?.refreshTabBarPosition();
        if (patch.showCacheHitRate !== undefined || patch.showTokensPerSecond !== undefined) {
          maintenance?.refreshChatDisplaySettings();
        }
      }
    }
    await host.saveSettings();
    if (patch.deletedSessionRetentionDays !== undefined) await host.purgeExpiredDeletedSessionFiles();
  };
  const saveEditorSelectionToolbar = async (
    settings: EditorSelectionToolbarSettings,
  ): Promise<void> => {
    host.settings.editorSelectionToolbar = normalizeEditorSelectionToolbarSettings(settings);
    await host.saveSettings();
    if (!host.settings.editorSelectionToolbar.enabled) {
      getSelectionToolbarHost()?.dismissOverlay();
    }
  };
  const saveSubagents = async (patch: Partial<SettingsSubagentsSnapshot>): Promise<void> => {
    const current = getSubagentRuntimeSettingsFromBag(host.settings);
    host.settings.agentSettings.subagents = { ...current, ...patch };
    await host.saveSettings();
    for (const view of host.getAllViews()) {
      await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
    }
  };
  const saveToolSettings = async (
    patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0] & { disabledTools?: readonly string[] },
  ): Promise<void> => {
    const current = resolveObsidianToolsSettings(host.settings.agentSettings.obsidianTools);
    if (patch.externalDirectories) {
      for (const directory of patch.externalDirectories) {
        const validation = validateDirectoryPath(directory.realpath);
        if (!validation.valid) throw new Error(validation.error ?? 'Invalid external directory.');
      }
    }
    const vaultPath = host.getVaultPath?.() ?? null;
    const bashPermissions = patch.bashPermissions
      ? canonicalizeBashPermissions(patch.bashPermissions, defaultCaseInsensitiveExecutables())
      : [...current.bashPermissions];
    const requestedExternal = patch.externalDirectories
      ? canonicalizeExternalDirectories(patch.externalDirectories)
      : [...current.externalDirectoryPermissions];
    const externalDirectoryPermissions = vaultPath
      ? requestedExternal.filter((directory) => !isPathWithinVault(directory.realpath, vaultPath))
      : requestedExternal;
    const externalReadDirectories = enabledExternalDirectories(externalDirectoryPermissions);
    host.settings.agentSettings.obsidianTools = {
      ...current,
      ...(patch.allowBash !== undefined ? { allowBash: patch.allowBash } : {}),
      ...(patch.allowExternalRead !== undefined ? { allowExternalRead: patch.allowExternalRead } : {}),
      ...(patch.defaultReadMaxChars !== undefined ? { defaultReadMaxChars: patch.defaultReadMaxChars } : {}),
      bashPermissions,
      bashAllowlist: [],
      externalDirectoryPermissions,
      externalReadDirectories,
      disabledTools: patch.disabledTools ? [...patch.disabledTools] : current.disabledTools,
    };
    await host.saveSettings();
    for (const view of host.getAllViews()) {
      if (patch.disabledTools) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
      await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
    }
    if (patch.externalDirectories) {
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance
          .syncExternalReadDirectories(externalReadDirectories);
      }
    }
  };
  const refreshPrompt = async (): Promise<void> => {
    for (const view of host.getAllViews()) {
      await view.getChatHandle()?.maintenance.refreshRuntimePrompt()
        .catch((error) => { logger.warn('Failed to refresh prompt in a Pivi view', error); });
    }
  };
  return {
    complex: {
      models: createSettingsModelsPort(host, uiFacades, ws),
      skills: createSettingsSkillsPort(host, ws.skillsManagement),
      tools: {
        getSettings: () => {
          const settings = getObsidianToolsSettingsFromBag(host.settings);
          const vaultPath = host.getVaultPath?.() ?? null;
          return {
            allowBash: settings.allowBash,
            allowExternalRead: settings.allowExternalRead,
            bashPermissions: settings.bashPermissions ?? [],
            defaultReadMaxChars: settings.defaultReadMaxChars,
            externalDirectories: vaultPath
              ? (settings.externalDirectoryPermissions ?? []).filter(
                (directory) => !isPathWithinVault(directory.realpath, vaultPath),
              )
              : settings.externalDirectoryPermissions ?? [],
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
        validateExternalDirectory: (path) => {
          const validation = validateDirectoryPath(path);
          if (!validation.valid) return Promise.resolve(validation);
          const vaultPath = host.getVaultPath?.() ?? null;
          if (vaultPath && isPathWithinVault(path, vaultPath)) {
            return Promise.resolve({
              valid: false,
              error: t('settings.permissions.external.insideWorkspace'),
            });
          }
          return Promise.resolve(validation);
        },
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
          const next = resolveWebSearchToolsSettings({
            ...resolveWebSearchToolsSettings(host.settings.agentSettings.webSearchTools),
            ...patch,
          });
          host.settings.agentSettings.webSearchTools = next;
          // Device-local webSearchTools commits before the vault write; keep runtime aligned on failure.
          await host.saveSettings();
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
        refreshPrompt,
        refreshModelSelectors: () => {
          for (const view of host.getAllViews()) {
            view.getChatHandle()?.maintenance.refreshModelPresentation();
          }
        },
      },
      commands: {
        refresh: () => ws.slashCommandCatalog.refresh(),
        listIconNames: () => getIconIds(),
        loadWorkspaceCatalog: () => ws.slashCommandCatalog.getWorkspaceSnapshot(),
        listDropdownEntries: () => ws.slashCommandCatalog.listDropdownEntries({ includeBuiltIns: true }),
        async saveWorkspaceEntry(entry, catalogRevision) {
          await ws.slashCommandCatalog.saveWorkspaceEntry(entry, catalogRevision);
          const saved = (await ws.slashCommandCatalog.listWorkspaceEntries())
            .find(candidate => candidate.id === entry.id);
          if (!saved) {
            throw new Error(`Saved workspace command /${entry.name} was not found`);
          }
          if (saved.integrationKey && host.settings.editorSelectionToolbar.shortcuts.some(
            shortcut => shortcut.kind === 'pivi-command'
              && shortcut.piviCommandKey === saved.integrationKey,
          )) {
            host.settings.editorSelectionToolbar = {
              ...host.settings.editorSelectionToolbar,
              shortcuts: host.settings.editorSelectionToolbar.shortcuts.map((shortcut) => {
                if (
                  shortcut.kind !== 'pivi-command'
                  || shortcut.piviCommandKey !== saved.integrationKey
                ) {
                  return shortcut;
                }
                const updated = { ...shortcut, label: `/${saved.name}` };
                if (saved.icon) updated.icon = saved.icon;
                else delete updated.icon;
                return updated;
              }),
            };
            await host.saveSettings();
          }
          invalidateSlashCatalog(host);
          return saved;
        },
        async renameWorkspaceEntry(previous, entry, catalogRevision) {
          await ws.slashCommandCatalog.renameWorkspaceEntry(previous, entry, catalogRevision);
          const saved = (await ws.slashCommandCatalog.listWorkspaceEntries()).find(
            candidate => candidate.id === entry.id);
          if (!saved) throw new Error(`Renamed workspace command /${entry.name} was not found`);
          invalidateSlashCatalog(host);
          return saved;
        },
        async deleteWorkspaceEntry(entry, catalogRevision) {
          const result = await ws.slashCommandCatalog.deleteWorkspaceEntry(entry, catalogRevision);
          invalidateSlashCatalog(host);
          return result;
        },
        async saveWorkspaceOrder(ids, catalogRevision) {
          await ws.slashCommandCatalog.saveWorkspaceOrder(ids, catalogRevision);
          invalidateSlashCatalog(host);
        },
      },
      mcp: createMcpSettingsPort(host, ws),
    },
    feedback: { notify: (message, timeout) => { const notice = host.notify(message, timeout); return notice ? { hide: () => notice.hide() } : undefined; } },
    snapshot: { getSnapshot: snapshot },
    actions: {
      saveGeneral,
      saveEditorSelectionToolbar,
      saveSubagents,
      loadSessionMaintenance: () => host.loadSessionMaintenance(),
      deleteAllArchivedChats: () => host.deleteAllArchivedChats(),
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
      listEntries: (scope) => host.listEnvironmentEntries(scope),
      applyEnvironmentVariables: (scope, envText) => host.applyEnvironmentVariables(scope, envText),
      applyEnvironmentVariablesBatch: (updates) => host.applyEnvironmentVariablesBatch(updates),
      importEnvironmentText: (scope, envText) => host.importEnvironmentText(scope, envText),
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
    editorToolbar: {
      listHostCommands: () => listObsidianCommands(host.app),
      listPiviCommands: async () => {
        const entries = await ws.slashCommandCatalog.listWorkspaceEntries();
        return entries
          .filter((entry) => entry.kind === 'command' && Boolean(entry.integrationKey))
          .map((entry) => ({
            key: entry.integrationKey as string,
            name: entry.name,
            description: entry.description,
            ...(entry.icon ? { icon: entry.icon } : {}),
          }));
      },
      listIconNames: () => getIconIds(),
      isNoteToolbarTextToolbarActive: () => isNoteToolbarTextToolbarActive(host.app),
    },
    catalog: {
      listModelsForProvider: (providerId) => uiFacades.listModelsForProvider(
        providerId,
        host.settings.customContextLimits,
      ),
      listCatalogModels: () => uiFacades.listCatalogModels(host.settings),
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
    mentionEditor: createMentionEditorPort(host, ws),
    prompt: createSettingsPromptPort(host, ws, refreshPrompt),
    about: {
      getSnapshot: () => ({
        version: PIVI_VERSION,
        releasedAt: PIVI_RELEASED_AT,
        githubUrl: PIVI_GITHUB_URL,
        issuesUrl: PIVI_ISSUES_URL,
      }),
    },
  };
}
