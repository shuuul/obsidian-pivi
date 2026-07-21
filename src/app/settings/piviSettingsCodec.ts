import {
  normalizePathForComparison,
  normalizePathForFilesystem,
} from "@pivi/obsidian-host/path";
import type {
  PiviSettingsCodec,
  PiviSettingsNormalizationResult,
} from "@pivi/obsidian-host/settings/piviSettingsStorage";
import { reconcileActiveModelFields } from "@pivi/pivi-agent-core/foundation/activeModel";
import {
  normalizePiAgentSettingsRecord,
  updatePiAgentSettings,
} from "@pivi/pivi-agent-core/foundation/agentSettings";
import type { DeviceLocalProviderStateV1 } from "@pivi/pivi-agent-core/foundation/deviceLocalProviderState";
import {
  extractDeviceLocalProviderState,
  overlayDeviceLocalProviderState,
  stripLocalizedFieldsFromRuntimeSettings,
} from "@pivi/pivi-agent-core/foundation/deviceLocalProviderState";
import {
  type AgentRuntimeSettings,
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  getObsidianToolsSettingsFromBag,
  normalizeEditorSelectionToolbarSettings,
  normalizeHiddenCommandList,
  type PiviSettings,
  resolveObsidianToolsSettings,
  resolveSubagentRuntimeSettings,
  resolveWebSearchToolsSettings,
} from "@pivi/pivi-agent-core/foundation/settings";
import {
  getSharedEnvironmentVariables,
} from "@pivi/pivi-agent-core/foundation/settingsAgentEnvironment";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";
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
}

export function normalizeStoredPiviSettings(
  stored: Record<string, unknown>,
): PiviSettingsNormalizationResult {
  const hiddenSlashCommands = normalizeHiddenCommandList(
    stored.hiddenSlashCommands,
  );
  const storedEditorSelectionToolbar = stored.editorSelectionToolbar;
  const editorSelectionToolbar = normalizeEditorSelectionToolbarSettings(
    storedEditorSelectionToolbar,
  );
  const editorSelectionToolbarChanged = JSON.stringify(storedEditorSelectionToolbar ?? null)
    !== JSON.stringify(editorSelectionToolbar);
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
    editorSelectionToolbar,
    agentSettings,
    chatViewPlacement,
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
    stored.chatViewPlacement !== chatViewPlacement ||
    externalReadDirectoriesMigrated ||
    subagentsChanged ||
    webSearchToolsChanged ||
    editorSelectionToolbarChanged ||
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function stripDeviceLocalSettings(settings: PiviSettings): PiviSettings {
  const agentSettings = { ...settings.agentSettings };
  const obsidianTools = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  const syncedObsidianTools = { ...obsidianTools };
  Reflect.deleteProperty(syncedObsidianTools, 'externalReadDirectories');
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

export function createPiviSettingsCodec(
  deviceLocalExternalContexts?: DeviceLocalExternalReadDirectories,
  deviceLocalProviders?: DeviceLocalProviderSettings,
): PiviSettingsCodec {
  return {
    getDefaults() {
      const settings = {
        ...DEFAULT_PIVI_SETTINGS,
        agentSettings: { ...DEFAULT_PIVI_SETTINGS.agentSettings },
      };
      if (deviceLocalExternalContexts) {
        setExternalReadDirectories(
          settings,
          deviceLocalExternalContexts.getExternalReadDirectories(),
        );
      }
      const initializedProviders = deviceLocalProviders?.loadInitialized();
      if (initializedProviders) {
        overlayDeviceLocalProviderState(settings, initializedProviders);
      }
      return settings;
    },
    normalize(stored) {
      const result = normalizeStoredPiviSettings(stored);
      let changed = result.changed;
      if (deviceLocalExternalContexts) {
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
      }
      if (!deviceLocalExternalContexts) {
        return nextSettings;
      }
      const withTools = nextSettings as PiviSettings;
      deviceLocalExternalContexts.setExternalReadDirectories(
        getObsidianToolsSettingsFromBag(withTools).externalReadDirectories,
      );
      return stripDeviceLocalSettings(withTools);
    },
  };
}
