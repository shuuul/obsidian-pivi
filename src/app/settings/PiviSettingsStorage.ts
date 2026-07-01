import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  normalizeEnvironmentScope,
  resolveEnvironmentSnippetScope,
} from "../../core/agent/AgentEnvironment";
import { normalizeHiddenCommandList } from "../../core/agent/commands/hiddenCommands";
import { PIVI_SETTINGS_PATH } from "../../core/bootstrap/StoragePaths";
import { reconcileActiveModelFields } from "../../core/settings/activeModel";
import { DEFAULT_AGENT_SETTINGS } from "../../core/settings/agentDefaults";
import type { FileStore } from "../../core/storage/FileStore";
import {
  type AgentRuntimeSettings,
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type EnvSnippet,
  type PiviSettings,
} from "../../core/types/settings";
import {
  normalizePiAgentSettingsRecord,
  updatePiAgentSettings,
} from "../../pi/settings";
import { DEFAULT_PIVI_SETTINGS } from "./defaultSettings";

export { PIVI_SETTINGS_PATH };

export type StoredPiviSettings = PiviSettings;

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

function normalizeContextLimits(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeEnvSnippets(value: unknown): EnvSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: EnvSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.description !== "string" ||
      typeof candidate.envVars !== "string"
    ) {
      continue;
    }

    snippets.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      envVars: candidate.envVars,
      scope: resolveEnvironmentSnippetScope(
        candidate.envVars,
        normalizeEnvironmentScope(candidate.scope) ??
          inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
    });
  }

  return snippets;
}

export class PiviSettingsStorage {
  constructor(private adapter: FileStore) {}

  async load(): Promise<StoredPiviSettings> {
    if (!(await this.adapter.exists(PIVI_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(PIVI_SETTINGS_PATH);
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      console.warn("Pivi: settings JSON is invalid; using defaults", error);
      return this.getDefaults();
    }
    const hiddenSlashCommands = normalizeHiddenCommandList(
      stored.hiddenSlashCommands,
    );
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const agentSettings = normalizeAgentSettings(stored);
    const chatViewPlacement = normalizeChatViewPlacement(
      stored.chatViewPlacement,
    );
    const providerSettings = {
      ...stored,
      hiddenSlashCommands,
      agentSettings,
    } as Record<string, unknown>;
    delete providerSettings.systemPrompt;
    delete providerSettings.mediaFolder;

    const merged: PiviSettings = {
      ...this.getDefaults(),
      ...stored,
      sharedEnvironmentVariables:
        getSharedEnvironmentVariables(providerSettings),
      envSnippets,
      hiddenSlashCommands,
      agentSettings,
      chatViewPlacement,
    };
    delete merged.systemPrompt;
    delete (merged as Record<string, unknown>).mediaFolder;

    const agentSettingsChanged = normalizePiAgentSettingsRecord(
      merged,
      providerSettings,
    );
    const modelReconciled = reconcileActiveModelFields(merged);

    if (
      agentSettingsChanged ||
      modelReconciled ||
      JSON.stringify(envSnippets) !==
        JSON.stringify(stored.envSnippets ?? []) ||
      stored.chatViewPlacement !== chatViewPlacement ||
      Object.hasOwn(stored, "systemPrompt") ||
      Object.hasOwn(stored, "mediaFolder")
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredPiviSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await this.adapter.write(PIVI_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(PIVI_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredPiviSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  async setLastModel(model: string, isCustom: boolean): Promise<void> {
    if (isCustom) {
      await this.update({ lastCustomModel: model });
      return;
    }

    const current = await this.load();
    updatePiAgentSettings(current, {
      lastModel: model,
    });
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updatePiAgentSettings(current, {
      environmentHash: hash,
    });
    await this.save(current);
  }

  private getDefaults(): StoredPiviSettings {
    return DEFAULT_PIVI_SETTINGS;
  }
}
