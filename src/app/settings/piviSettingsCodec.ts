import { normalizePromptModuleSettings } from "@pivi/agent/prompt";
import { reconcileActiveModelFields } from "@pivi/agent/settings/activeModel";
import {
  getSharedEnvironmentVariables,
} from "@pivi/agent/settings/agentEnvironment";
import {
  normalizePiAgentSettingsRecord,
} from "@pivi/agent/settings/agentSettings";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_PIVI_SETTINGS } from "@pivi/agent/settings/defaults";
import type { DeviceLocalProviderStateV1 } from "@pivi/agent/settings/deviceLocalProviderState";
import {
  extractDeviceLocalProviderState,
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
  DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
  type DeviceLocalCapabilityPermissions as DeviceLocalCapabilityPermissionState,
  enabledExternalDirectories,
  migrateLegacyCapabilityPermissions,
} from "@pivi/agent/tools";
import {
  normalizePathForComparison,
  normalizePathForFilesystem,
} from "@pivi/obsidian-host/path";
import type {
  PiviSettingsCodec,
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

/** Agent-settings fields earlier versions persisted; dropped on load. */
const REMOVED_AGENT_SETTINGS_FIELDS = ['selectedMode', 'environmentHash', 'lastModel'] as const;

function isAgentRuntimeSettings(value: unknown): value is AgentRuntimeSettings {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentSettings(
  stored: Record<string, unknown>,
): AgentRuntimeSettings {
  if (isAgentRuntimeSettings(stored.agentSettings)) {
    const agentSettings: Record<string, unknown> = { ...stored.agentSettings };
    for (const field of REMOVED_AGENT_SETTINGS_FIELDS) delete agentSettings[field];
    return agentSettings as unknown as AgentRuntimeSettings;
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
): void {
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

}

/** Top-level fields earlier versions persisted; dropped on load. */
const REMOVED_SETTINGS_FIELDS = [
  'systemPrompt',
  'mediaFolder',
  'envSnippets',
  'maxTabs',
  'enableAutoCompact',
  'autoCompactThresholdRatio',
  'autoCompactKeepRecentTokens',
  'thinkingBudget',
  'permissionMode',
  'lastCustomModel',
] as const;

function stripRemovedSettingsFields(settings: Record<string, unknown>): void {
  for (const field of REMOVED_SETTINGS_FIELDS) delete settings[field];
  delete settings.persistentExternalContextPaths;
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

/** Builds runtime settings from the synced vault file, repairing and dropping stale fields. */
export function normalizeStoredPiviSettings(
  stored: Record<string, unknown>,
): PiviSettings {
  const hiddenSlashCommands = normalizeHiddenCommandList(
    stored.hiddenSlashCommands,
  );
  const promptNormalized = normalizePromptModuleSettings(
    stored.promptModules,
    stored.customPromptModules,
  );
  const agentSettings = normalizeAgentSettings(stored);
  agentSettings.subagents = resolveSubagentRuntimeSettings(agentSettings.subagents);
  agentSettings.webSearchTools = resolveWebSearchToolsSettings(agentSettings.webSearchTools);
  migrateExternalReadDirectories(stored, agentSettings);
  const retention = stored.deletedSessionRetentionDays;
  const deletedSessionRetentionDays = typeof retention === 'number'
    && Number.isInteger(retention)
    && retention >= 1
    && retention <= 3650
    ? retention
    : DEFAULT_PIVI_SETTINGS.deletedSessionRetentionDays;
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
    workspaceCommandOrder: normalizeWorkspaceCommandOrder(stored.workspaceCommandOrder),
    editorSelectionToolbar: normalizeEditorSelectionToolbarSettings(
      stored.editorSelectionToolbar,
    ),
    agentSettings,
    chatViewPlacement: normalizeChatViewPlacement(stored.chatViewPlacement),
    deletedSessionRetentionDays,
    providerRequestDeadlines: normalizeProviderRequestDeadlines(
      stored.providerRequestDeadlines,
    ),
    promptModules: promptNormalized.promptModules,
    customPromptModules: promptNormalized.customPromptModules,
  };
  stripRemovedSettingsFields(settings);
  normalizePiAgentSettingsRecord(settings, providerSettings);
  reconcileActiveModelFields(settings);
  return settings;
}

export interface DeviceLocalExternalReadDirectories {
  getExternalReadDirectories(): string[];
  setExternalReadDirectories(paths: readonly string[]): void;
}

export interface DeviceLocalProviderSettings {
  loadInitialized(): DeviceLocalProviderStateV1 | null;
  save(state: DeviceLocalProviderStateV1): void;
}

function setCapabilityOverlay(
  settings: PiviSettings,
  snapshot: DeviceLocalCapabilityPermissionState,
): void {
  settings.agentSettings = {
    ...settings.agentSettings,
    obsidianTools: {
      ...resolveObsidianToolsSettings(settings.agentSettings.obsidianTools),
      bashPermissions: [...snapshot.bash],
      bashAllowlist: [],
      commandAllowlist: [...snapshot.obsidianCommands],
      externalReadDirectories: enabledExternalDirectories(snapshot.externalDirectories),
      externalDirectoryPermissions: [...snapshot.externalDirectories],
    },
  };
}

export function mergeExternalDirectoryPermissions(
  stored: DeviceLocalCapabilityPermissionState['externalDirectories'],
  enabledPaths: readonly string[],
): DeviceLocalCapabilityPermissionState['externalDirectories'] {
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
  Reflect.deleteProperty(syncedObsidianTools, 'commandAllowlist');
  agentSettings.obsidianTools = syncedObsidianTools;
  return { ...settings, agentSettings };
}

function hasSyncedCommandAllowlist(stored: Record<string, unknown>): boolean {
  const agentSettings = stored.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return false;
  }
  const obsidianTools = (agentSettings as Record<string, unknown>).obsidianTools;
  return !!obsidianTools
    && typeof obsidianTools === 'object'
    && !Array.isArray(obsidianTools)
    && Object.hasOwn(obsidianTools, 'commandAllowlist');
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
  needsLegacyCommandGrantMigration(): boolean;
  getSnapshot(): DeviceLocalCapabilityPermissionState;
  save(next: DeviceLocalCapabilityPermissionState): DeviceLocalCapabilityPermissionState;
}

/**
 * Installs this device's persistent Bash, command, and external-directory grants
 * on freshly loaded settings, migrating legacy synced grants the first time.
 * Saving writes the in-memory grants back to the device store, so a load that
 * skips this overlay erases them on the next save.
 *
 * @returns whether the synced file still carries grants that a save must strip.
 */
export function overlayDeviceLocalCapabilityPermissions(
  settings: PiviSettings,
  stored: Record<string, unknown>,
  capabilities: DeviceLocalCapabilityPermissions,
  legacyExternalContexts?: DeviceLocalExternalReadDirectories,
): boolean {
  const tools = getObsidianToolsSettingsFromBag(settings);
  if (!capabilities.hasRecord()) {
    const legacyDirectories = normalizeExternalReadDirectories([
      ...(legacyExternalContexts?.getExternalReadDirectories() ?? []),
      ...tools.externalReadDirectories,
    ]);
    const legacy = migrateLegacyCapabilityPermissions({
      bashAllowlist: tools.bashAllowlist,
      externalReadDirectories: legacyDirectories,
    });
    capabilities.save({
      ...legacy.permissions,
      obsidianCommands: [...tools.commandAllowlist],
    });
    legacyExternalContexts?.setExternalReadDirectories([]);
  } else if (capabilities.needsLegacyCommandGrantMigration()) {
    const current = capabilities.getSnapshot();
    capabilities.save({
      ...current,
      obsidianCommands: [...current.obsidianCommands, ...tools.commandAllowlist],
    });
  }
  setCapabilityOverlay(settings, capabilities.getSnapshot());
  return hasSyncedExternalReadDirectories(stored)
    || hasSyncedBashAllowlist(stored)
    || hasSyncedCommandAllowlist(stored);
}

/**
 * Projects runtime settings onto the synced vault file: device-local provider
 * and capability state is written to its own store and stripped from the result.
 */
export function createPiviSettingsCodec(
  deviceLocalProviders: DeviceLocalProviderSettings,
  deviceLocalCapabilities: DeviceLocalCapabilityPermissions,
): PiviSettingsCodec {
  return {
    prepareForSave(settings) {
      deviceLocalProviders.save(extractDeviceLocalProviderState(settings));
      const tools = getObsidianToolsSettingsFromBag(settings);
      const current = deviceLocalCapabilities.getSnapshot();
      deviceLocalCapabilities.save(canonicalizeCapabilityPermissions({
        version: DEVICE_LOCAL_CAPABILITY_PERMISSIONS_VERSION,
        bash: tools.bashPermissions,
        obsidianCommands: tools.commandAllowlist,
        externalDirectories: tools.externalDirectoryPermissions.length > 0
          ? tools.externalDirectoryPermissions
          : mergeExternalDirectoryPermissions(
            current.externalDirectories,
            tools.externalReadDirectories,
          ),
      }));
      return stripDeviceLocalSettings(
        stripLocalizedFieldsFromRuntimeSettings(settings) as PiviSettings,
      );
    },
  };
}
