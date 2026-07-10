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
import {
  type AgentRuntimeSettings,
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  normalizeHiddenCommandList,
  type PiviSettings,
  resolveObsidianToolsSettings,
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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
  return Math.min(max, Math.max(min, numeric));
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
}

export function normalizeStoredPiviSettings(
  stored: Record<string, unknown>,
): PiviSettingsNormalizationResult {
  const hiddenSlashCommands = normalizeHiddenCommandList(
    stored.hiddenSlashCommands,
  );
  const agentSettings = normalizeAgentSettings(stored);
  const externalReadDirectoriesMigrated = migrateExternalReadDirectories(
    stored,
    agentSettings,
  );
  const chatViewPlacement = normalizeChatViewPlacement(stored.chatViewPlacement);
  const autoCompactThresholdRatio = clampNumber(
    stored.autoCompactThresholdRatio,
    DEFAULT_PIVI_SETTINGS.autoCompactThresholdRatio,
    0.5,
    0.95,
  );
  const autoCompactKeepRecentTokens = Math.round(clampNumber(
    stored.autoCompactKeepRecentTokens,
    DEFAULT_PIVI_SETTINGS.autoCompactKeepRecentTokens,
    1_000,
    200_000,
  ));
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
    agentSettings,
    chatViewPlacement,
    enableAutoCompact: typeof stored.enableAutoCompact === "boolean"
      ? stored.enableAutoCompact
      : DEFAULT_PIVI_SETTINGS.enableAutoCompact,
    autoCompactThresholdRatio,
    autoCompactKeepRecentTokens,
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
    stored.autoCompactThresholdRatio !== autoCompactThresholdRatio ||
    stored.autoCompactKeepRecentTokens !== autoCompactKeepRecentTokens ||
    externalReadDirectoriesMigrated ||
    Object.hasOwn(stored, "systemPrompt") ||
    Object.hasOwn(stored, "mediaFolder") ||
    Object.hasOwn(stored, "envSnippets") ||
    Object.hasOwn(stored, "maxTabs");

  return { settings, changed };
}

export function createPiviSettingsCodec(): PiviSettingsCodec {
  return {
    getDefaults() {
      return { ...DEFAULT_PIVI_SETTINGS };
    },
    normalize: normalizeStoredPiviSettings,
    updateAgentSettings(settings, updates) {
      updatePiAgentSettings(settings, updates);
    },
  };
}
