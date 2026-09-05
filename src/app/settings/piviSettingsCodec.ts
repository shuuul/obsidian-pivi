import { normalizePromptModuleSettings } from "@pivi/agent/prompt";
import { reconcileActiveModelFields } from "@pivi/agent/settings/activeModel";
import {
  getSharedEnvironmentVariables,
} from "@pivi/agent/settings/agentEnvironment";
import {
  normalizePiAgentSettingsRecord,
  updatePiAgentSettings,
} from "@pivi/agent/settings/agentSettings";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_PIVI_SETTINGS } from "@pivi/agent/settings/defaults";
import type { DeviceLocalEnvironmentStateV1 } from "@pivi/agent/settings/deviceLocalEnvironmentState";
import {
  createSecretStoreResolveHost,
  projectEnvironmentOntoSettings,
  stripEnvironmentFieldsFromPersistedSettings,
} from "@pivi/agent/settings/deviceLocalEnvironmentState";
import type { DeviceLocalProviderStateV1 } from "@pivi/agent/settings/deviceLocalProviderState";
import {
  extractDeviceLocalProviderState,
  overlayDeviceLocalProviderState,
  stripLocalizedFieldsFromRuntimeSettings,
} from "@pivi/agent/settings/deviceLocalProviderState";
import {
  type AgentRuntimeSettings,
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  getObsidianToolsSettingsFromBag,
  normalizeEditorSelectionToolbarSettings,
  normalizeHiddenCommandList,
  normalizeWorkspaceCommandOrder,
  type PiviSettings,
  resolveObsidianToolsSettings,
  resolveSubagentRuntimeSettings,
  resolveWebSearchToolsSettings,
} from "@pivi/agent/settings/types";
import {
  canonicalizeCapabilityPermissions,
  type DeviceLocalCapabilityPermissionsV1,
  enabledExternalDirectories,
  migrateLegacyCapabilityPermissions,
} from "@pivi/agent/tools";
import {
  normalizePathForComparison,
  normalizePathForFilesystem,
} from "@pivi/obsidian-host/path";
import type {
  PiviSettingsCodec,
  PiviSettingsNormalizationResult,
} from "@pivi/obsidian-host/settings/piviSettingsStorage";
import * as path from "path";

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return (
    typeof value === "string" &&
    (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value)
  );
}

function normalizeChatViewPlacement(value: unknown): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  return DEFAULT_PIVI_SETTINGS.chatViewPlacement;
}

function isAgentRuntimeSettings(value: unknown): value is AgentRuntimeSettings {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentSettings(
  stored: Record<string, unknown>,
): AgentRuntimeSettings {
  if (isAgentRuntimeSettings(stored.agentSettings)) {
    return { ...stored.agentSettings };
  }

  return {
    ...DEFAULT_AGENT_SETTINGS,
    environmentVariables: DEFAULT_AGENT_SETTINGS.environmentVariables,
  };
}

function normalizeExternalReadDirectories(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalizedPath = normalizePathForFilesystem(value.trim());
    const root = path.parse(normalizedPath).root;
    const normalized = normalizedPath.length > root.length
      ? normalizedPath.replace(/[\\/]+$/, "")
      : normalizedPath;
    const key = normalizePathForComparison(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    directories.push(normalized);
  }

  return directories;
}

function migrateExternalReadDirectories(
  stored: Record<string, unknown>,
  agentSettings: AgentRuntimeSettings,
): boolean {
  const obsidianTools = agentSettings.obsidianTools;
  const currentDirectories = Array.isArray(obsidianTools?.externalReadDirectories)
    ? obsidianTools.externalReadDirectories
    : [];
  const legacyValue = stored.persistentExternalContextPaths;
  const legacyDirectories: readonly unknown[] = Array.isArray(legacyValue)
    ? legacyValue
    : [];
  const directories = normalizeExternalReadDirectories([
    ...currentDirectories,
    ...legacyDirectories,
  ]);

  if (directories.length > 0 || Array.isArray(obsidianTools?.externalReadDirectories)) {
    agentSettings.obsidianTools = {
      ...resolveObsidianToolsSettings(obsidianTools),
      externalReadDirectories: directories,
    };
  }

  return (
    Object.hasOwn(stored, "persistentExternalContextPaths") ||
    JSON.stringify(obsidianTools ?? null) !== JSON.stringify(agentSettings.obsidianTools ?? null)
  );
}

function stripRemovedSettingsFields(settings: Record<string, unknown>): void {
  delete settings.systemPrompt;
  delete settings.mediaFolder;
  delete settings.envSnippets;
  delete settings.maxTabs;
  delete settings.persistentExternalContextPaths;
  delete settings.enableAutoCompact;
  delete settings.autoCompactThresholdRatio;
  delete settings.autoCompactKeepRecentTokens;
  delete settings.keyboardNavigation;
}

function normalizeDeadlineMs(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizeProviderRequestDeadlines(raw: unknown): PiviSettings['providerRequestDeadlines'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PIVI_SETTINGS.providerRequestDeadlines };
  }
  const record = raw as Record<string, unknown>;
  return {
    totalMs: normalizeDeadlineMs(
      record.totalMs,
      DEFAULT_PIVI_SETTINGS.providerRequestDeadlines.totalMs,
    ),
    idleMs: normalizeDeadlineMs(
      record.idleMs,
      DEFAULT_PIVI_SETTINGS.providerRequestDeadlines.idleMs,
    ),
  };
}

function hasGeneralNormalizationChanges(
  stored: Record<string, unknown>,
  chatViewPlacement: PiviSettings['chatViewPlacement'],
  deletedSessionRetentionDays: number,
  providerRequestDeadlines: PiviSettings['providerRequestDeadlines'],
  promptModulesChanged: boolean,
): boolean {
  return stored.chatViewPlacement !== chatViewPlacement
    || stored.deletedSessionRetentionDays !== deletedSessionRetentionDays
    || JSON.stringify(stored.providerRequestDeadlines ?? null)
      !== JSON.stringify(providerRequestDeadlines)
    || promptModulesChanged;
}

function promptModuleSettingsChanged(
  stored: Record<string, unknown>,
  normalized: ReturnType<typeof normalizePromptModuleSettings>,
): boolean {
  return JSON.stringify(stored.promptModules ?? null)
    !== JSON.stringify(normalized.promptModules)
    || JSON.stringify(stored.customPromptModules ?? null)
      !== JSON.stringify(normalized.customPromptModules);
}

export function normalizeStoredPiviSettings(
  stored: Record<string, unknown>,
): PiviSettingsNormalizationResult {
  const hiddenSlashCommands = normalizeHiddenCommandList(
    stored.hiddenSlashCommands,
  );
  const storedWorkspaceCommandOrder = stored.workspaceCommandOrder;
  const workspaceCommandOrder = normalizeWorkspaceCommandOrder(
    storedWorkspaceCommandOrder,
  );
  const workspaceCommandOrderChanged = JSON.stringify(storedWorkspaceCommandOrder ?? null)
    !== JSON.stringify(workspaceCommandOrder);
  const storedEditorSelectionToolbar = stored.editorSelectionToolbar;
  const editorSelectionToolbar = normalizeEditorSelectionToolbarSettings(
    storedEditorSelectionToolbar,
  );
  const editorSelectionToolbarChanged = JSON.stringify(storedEditorSelectionToolbar ?? null)
    !== JSON.stringify(editorSelectionToolbar);
  const promptNormalized = normalizePromptModuleSettings(
    stored.promptModules,
    stored.customPromptModules,
  );
  const promptModulesChanged = promptModuleSettingsChanged(stored, promptNormalized);
  const agentSettings = normalizeAgentSettings(stored);
  const storedSubagents = agentSettings.subagents;
  const normalizedSubagents = resolveSubagentRuntimeSettings(storedSubagents);
  const subagentsChanged = JSON.stringify(storedSubagents ?? null)
    !== JSON.stringify(normalizedSubagents);
  agentSettings.subagents = normalizedSubagents;
  const storedWebSearchTools = agentSettings.webSearchTools;
  const normalizedWebSearchTools = resolveWebSearchToolsSettings(storedWebSearchTools);
  const webSearchToolsChanged = JSON.stringify(storedWebSearchTools ?? null)
    !== JSON.stringify(normalizedWebSearchTools);
  agentSettings.webSearchTools = normalizedWebSearchTools;
  const externalReadDirectoriesMigrated = migrateExternalReadDirectories(
    stored,
    agentSettings,
  );
  const chatViewPlacement = normalizeChatViewPlacement(stored.chatViewPlacement);
  const retention = stored.deletedSessionRetentionDays;
  const deletedSessionRetentionDays = typeof retention === 'number'
    && Number.isInteger(retention)
    && retention >= 1
    && retention <= 3650
    ? retention
    : DEFAULT_PIVI_SETTINGS.deletedSessionRetentionDays;
  const providerRequestDeadlines = normalizeProviderRequestDeadlines(
    stored.providerRequestDeadlines,
  );
  const providerSettings = {
    ...stored,
    hiddenSlashCommands,
    agentSettings,
  };
  stripRemovedSettingsFields(providerSettings);

  const settings: PiviSettings = {
    ...DEFAULT_PIVI_SETTINGS,
    ...stored,
    sharedEnvironmentVariables:
      getSharedEnvironmentVariables(providerSettings),
    hiddenSlashCommands,
    workspaceCommandOrder,
    editorSelectionToolbar,
    agentSettings,
    chatViewPlacement,
    deletedSessionRetentionDays,
    providerRequestDeadlines,
    promptModules: promptNormalized.promptModules,
    customPromptModules: promptNormalized.customPromptModules,
  };
  stripRemovedSettingsFields(settings);

  const agentSettingsChanged = normalizePiAgentSettingsRecord(
    settings,
    providerSettings,
  );
  const modelReconciled = reconcileActiveModelFields(settings);
  const changed =
    agentSettingsChanged ||
    modelReconciled ||
    hasGeneralNormalizationChanges(
      stored,
      chatViewPlacement,
      deletedSessionRetentionDays,
      providerRequestDeadlines,
      promptModulesChanged,
    ) ||
    externalReadDirectoriesMigrated ||
    subagentsChanged ||
    webSearchToolsChanged ||
    editorSelectionToolbarChanged ||
    workspaceCommandOrderChanged ||
    Object.hasOwn(stored, "systemPrompt") ||
    Object.hasOwn(stored, "mediaFolder") ||
    Object.hasOwn(stored, "envSnippets") ||
    Object.hasOwn(stored, "maxTabs") ||
    Object.hasOwn(stored, "enableAutoCompact") ||
    Object.hasOwn(stored, "autoCompactThresholdRatio") ||
    Object.hasOwn(stored, "autoCompactKeepRecentTokens");

  return { settings, changed };
}

export interface DeviceLocalExternalReadDirectories {
  getExternalReadDirectories(): string[];
  setExternalReadDirectories(paths: readonly string[]): void;
}

export interface DeviceLocalProviderSettings {
  loadInitialized(): DeviceLocalProviderStateV1 | null;
  save(state: DeviceLocalProviderStateV1): void;
}

export interface DeviceLocalEnvironmentSettings {
  loadInitialized(): DeviceLocalEnvironmentStateV1 | null;
  /** Optional secret/system hosts for runtime projection. */
  createResolveHost?(): ReturnType<typeof createSecretStoreResolveHost>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasSyncedEnvironmentFields(stored: Record<string, unknown>): boolean {
  if (Object.hasOwn(stored, 'sharedEnvironmentVariables')
    || Object.hasOwn(stored, 'environmentVariables')) {
    return true;
  }
  const agentSettings = stored.agentSettings;
  return isRecord(agentSettings) && Object.hasOwn(agentSettings, 'environmentVariables');
}

function hasSyncedLocalizedProviderFields(stored: Record<string, unknown>): boolean {
  if (Object.hasOwn(stored, 'model') || Object.hasOwn(stored, 'titleGenerationModel')) {
    return true;
  }
  if (Object.hasOwn(stored, 'customContextLimits')) {
    const limits = stored.customContextLimits;
    if (isRecord(limits) && Object.keys(limits).length > 0) {
      return true;
    }
  }
  const agentSettings = stored.agentSettings;
  if (!isRecord(agentSettings)) {
    return false;
  }
  const localizedKeys = [
    'addedProviders',
    'disabledProviders',
    'customProviders',
    'visibleModels',
    'lastModel',
    'webSearchTools',
  ] as const;
  return localizedKeys.some((key) => Object.hasOwn(agentSettings, key));
}

function setExternalReadDirectories(
  settings: PiviSettings,
  directories: readonly string[],
): void {
  settings.agentSettings = {
    ...settings.agentSettings,
    obsidianTools: {
      ...resolveObsidianToolsSettings(settings.agentSettings.obsidianTools),
      externalReadDirectories: [...directories],
    },
  };
}

function setCapabilityOverlay(
  settings: PiviSettings,
  snapshot: DeviceLocalCapabilityPermissionsV1,
): void {
  settings.agentSettings = {
    ...settings.agentSettings,
    obsidianTools: {
      ...resolveObsidianToolsSettings(settings.agentSettings.obsidianTools),
      bashPermissions: [...snapshot.bash],
      bashAllowlist: [],
      externalReadDirectories: enabledExternalDirectories(snapshot.externalDirectories),
      externalDirectoryPermissions: [...snapshot.externalDirectories],
    },
  };
}

function mergeExternalDirectoriesForSave(
  stored: DeviceLocalCapabilityPermissionsV1['externalDirectories'],
  enabledPaths: readonly string[],
): DeviceLocalCapabilityPermissionsV1['externalDirectories'] {
  const enabled = new Set(enabledPaths);
  const next = stored.map(directory => ({
    ...directory,
    enabled: enabled.has(directory.realpath),
  }));
  for (const path of enabledPaths) {
    if (!next.some(directory => directory.realpath === path)) {
      next.push({ realpath: path, enabled: true });
    }
  }
  return next;
}

function hasSyncedBashAllowlist(stored: Record<string, unknown>): boolean {
  const agentSettings = stored.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return false;
  }
  const obsidianTools = (agentSettings as Record<string, unknown>).obsidianTools;
  return !!obsidianTools
    && typeof obsidianTools === 'object'
    && !Array.isArray(obsidianTools)
    && Object.hasOwn(obsidianTools, 'bashAllowlist');
}

function stripDeviceLocalSettings(settings: PiviSettings): PiviSettings {
  const agentSettings = { ...settings.agentSettings };
  const obsidianTools = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  const syncedObsidianTools = { ...obsidianTools };
  Reflect.deleteProperty(syncedObsidianTools, 'externalReadDirectories');
  Reflect.deleteProperty(syncedObsidianTools, 'externalDirectoryPermissions');
  Reflect.deleteProperty(syncedObsidianTools, 'bashAllowlist');
  Reflect.deleteProperty(syncedObsidianTools, 'bashPermissions');
  agentSettings.obsidianTools = syncedObsidianTools;
  return { ...settings, agentSettings };
}

function hasSyncedExternalReadDirectories(stored: Record<string, unknown>): boolean {
  if (Object.hasOwn(stored, 'persistentExternalContextPaths')) {
    return true;
  }
  const agentSettings = stored.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return false;
  }
  const obsidianTools = (agentSettings as Record<string, unknown>).obsidianTools;
  return !!obsidianTools
    && typeof obsidianTools === 'object'
    && !Array.isArray(obsidianTools)
    && Object.hasOwn(obsidianTools, 'externalReadDirectories');
}

export interface DeviceLocalCapabilityPermissions {
  hasRecord(): boolean;
  getSnapshot(): DeviceLocalCapabilityPermissionsV1;
  save(next: DeviceLocalCapabilityPermissionsV1): DeviceLocalCapabilityPermissionsV1;
}

export function createPiviSettingsCodec(
  deviceLocalExternalContexts?: DeviceLocalExternalReadDirectories,
  deviceLocalProviders?: DeviceLocalProviderSettings,
  deviceLocalEnvironment?: DeviceLocalEnvironmentSettings,
  deviceLocalCapabilities?: DeviceLocalCapabilityPermissions,
): PiviSettingsCodec {
  return {
    getDefaults() {
      const settings = {
        ...DEFAULT_PIVI_SETTINGS,
        agentSettings: { ...DEFAULT_PIVI_SETTINGS.agentSettings },
      };
      if (deviceLocalCapabilities?.hasRecord()) {
        setCapabilityOverlay(settings, deviceLocalCapabilities.getSnapshot());
      } else if (deviceLocalExternalContexts) {
        setExternalReadDirectories(
          settings,
          deviceLocalExternalContexts.getExternalReadDirectories(),
        );
      }
      const initializedProviders = deviceLocalProviders?.loadInitialized();
      if (initializedProviders) {
        overlayDeviceLocalProviderState(settings, initializedProviders);
      }
      const initializedEnvironment = deviceLocalEnvironment?.loadInitialized();
      if (initializedEnvironment) {
        const host = deviceLocalEnvironment?.createResolveHost?.()
          ?? createSecretStoreResolveHost(undefined, () => undefined);
        projectEnvironmentOntoSettings(settings, initializedEnvironment, host);
      }
      return settings;
    },
    normalize(stored) {
      const result = normalizeStoredPiviSettings(stored);
      let changed = result.changed;
      if (deviceLocalCapabilities) {
        const tools = getObsidianToolsSettingsFromBag(result.settings);
        if (!deviceLocalCapabilities.hasRecord()) {
          const legacyDirectories = normalizeExternalReadDirectories([
            ...(deviceLocalExternalContexts?.getExternalReadDirectories() ?? []),
            ...tools.externalReadDirectories,
          ]);
          const migrated = migrateLegacyCapabilityPermissions({
            bashAllowlist: tools.bashAllowlist,
            externalReadDirectories: legacyDirectories,
          });
          deviceLocalCapabilities.save(migrated.permissions);
          deviceLocalExternalContexts?.setExternalReadDirectories([]);
          changed = true;
        }
        setCapabilityOverlay(result.settings, deviceLocalCapabilities.getSnapshot());
        changed = changed
          || hasSyncedExternalReadDirectories(stored)
          || hasSyncedBashAllowlist(stored);
      } else if (deviceLocalExternalContexts) {
        const syncedDirectories = getObsidianToolsSettingsFromBag(result.settings)
          .externalReadDirectories;
        const deviceDirectories = deviceLocalExternalContexts.getExternalReadDirectories();
        const mergedDirectories = normalizeExternalReadDirectories([
          ...deviceDirectories,
          ...syncedDirectories,
        ]);
        if (JSON.stringify(deviceDirectories) !== JSON.stringify(mergedDirectories)) {
          deviceLocalExternalContexts.setExternalReadDirectories(mergedDirectories);
        }
        setExternalReadDirectories(result.settings, mergedDirectories);
        changed = changed || hasSyncedExternalReadDirectories(stored);
      }
      const initializedProviders = deviceLocalProviders?.loadInitialized();
      if (initializedProviders) {
        overlayDeviceLocalProviderState(result.settings, initializedProviders);
        changed = changed || hasSyncedLocalizedProviderFields(stored);
      }
      const initializedEnvironment = deviceLocalEnvironment?.loadInitialized();
      if (initializedEnvironment) {
        const host = deviceLocalEnvironment?.createResolveHost?.()
          ?? createSecretStoreResolveHost(undefined, () => undefined);
        projectEnvironmentOntoSettings(result.settings, initializedEnvironment, host);
        changed = changed || hasSyncedEnvironmentFields(stored);
      } else if (hasSyncedEnvironmentFields(stored)) {
        // Legacy synced env remains readable until migration runs; mark dirty so
        // prepareForSave strips after cutover.
        changed = true;
      }
      return {
        settings: result.settings,
        changed,
      };
    },
    updateAgentSettings(settings, updates) {
      updatePiAgentSettings(settings, updates);
    },
    prepareForSave(settings) {
      let nextSettings: PiviSettings | ReturnType<typeof stripLocalizedFieldsFromRuntimeSettings> =
        settings;
      if (deviceLocalProviders) {
        const localState = extractDeviceLocalProviderState(settings);
        deviceLocalProviders.save(localState);
        nextSettings = stripLocalizedFieldsFromRuntimeSettings(settings);
      } else {
        // Still strip environment fields from synced JSON even without provider store.
        const persisted = { ...(nextSettings as unknown as Record<string, unknown>) };
        stripEnvironmentFieldsFromPersistedSettings(persisted);
        nextSettings = persisted as typeof nextSettings;
      }
      const withTools = nextSettings as PiviSettings;
      const tools = getObsidianToolsSettingsFromBag(withTools);
      if (deviceLocalCapabilities) {
        const current = deviceLocalCapabilities.getSnapshot();
        deviceLocalCapabilities.save(canonicalizeCapabilityPermissions({
          version: 1,
          bash: tools.bashPermissions,
          externalDirectories: tools.externalDirectoryPermissions.length > 0
            ? tools.externalDirectoryPermissions
            : mergeExternalDirectoriesForSave(
              current.externalDirectories,
              tools.externalReadDirectories,
            ),
        }));
      } else if (deviceLocalExternalContexts) {
        deviceLocalExternalContexts.setExternalReadDirectories(tools.externalReadDirectories);
      }
      if (!deviceLocalExternalContexts && !deviceLocalCapabilities) {
        return nextSettings;
      }
      return stripDeviceLocalSettings(withTools);
    },
  };
}
