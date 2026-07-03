import type {
  PiviSettingsCodec,
  PiviSettingsNormalizationResult,
} from "@pivi/obsidian-host/settings/PiviSettingsStorage";
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
} from "@pivi/pivi-agent-core/foundation/settings";
import {
  getSharedEnvironmentVariables,
} from "@pivi/pivi-agent-core/foundation/settingsAgentEnvironment";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";

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

function stripRemovedSettingsFields(settings: Record<string, unknown>): void {
  delete settings.systemPrompt;
  delete settings.mediaFolder;
  delete settings.envSnippets;
  delete settings.maxTabs;
}

export function normalizeStoredPiviSettings(
  stored: Record<string, unknown>,
): PiviSettingsNormalizationResult {
  const hiddenSlashCommands = normalizeHiddenCommandList(
    stored.hiddenSlashCommands,
  );
  const agentSettings = normalizeAgentSettings(stored);
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
