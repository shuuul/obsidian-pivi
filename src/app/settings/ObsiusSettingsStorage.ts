import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  normalizeEnvironmentScope,
  resolveEnvironmentSnippetScope,
} from '../../core/agent/agentEnvironment';
import { normalizeHiddenCommandList } from '../../core/agent/commands/hiddenCommands';
import { OBSIUS_SETTINGS_PATH } from '../../core/bootstrap/StoragePaths';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type EnvSnippet,
  type ObsiusSettings,
  type PiAgentSettings,
} from '../../core/types/settings';
import {
  getPiAgentSettings,
  updatePiAgentSettings,
} from '../../pi/settings';
import { reconcileActiveModelFields } from '../../core/settings/activeModel';
import { DEFAULT_PI_AGENT_SETTINGS } from '../../core/settings/agentDefaults';
import { DEFAULT_OBSIUS_SETTINGS } from './defaultSettings';

export { OBSIUS_SETTINGS_PATH };

export type StoredObsiusSettings = ObsiusSettings;

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(value: unknown): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  return DEFAULT_OBSIUS_SETTINGS.chatViewPlacement;
}

function isPiAgentSettings(value: unknown): value is PiAgentSettings {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePiSettings(stored: Record<string, unknown>): PiAgentSettings {
  if (isPiAgentSettings(stored.piSettings)) {
    return { ...stored.piSettings };
  }

  return {
    ...DEFAULT_PI_AGENT_SETTINGS,
    environmentVariables: DEFAULT_PI_AGENT_SETTINGS.environmentVariables,
  };
}

function normalizeContextLimits(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
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
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.envVars !== 'string'
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
        normalizeEnvironmentScope(candidate.scope)
          ?? inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
    });
  }

  return snippets;
}

export class ObsiusSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredObsiusSettings> {
    if (!(await this.adapter.exists(OBSIUS_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(OBSIUS_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const hiddenSlashCommands = normalizeHiddenCommandList(stored.hiddenSlashCommands);
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const piSettings = normalizePiSettings(stored);
    const chatViewPlacement = normalizeChatViewPlacement(stored.chatViewPlacement);
    const providerSettings = {
      ...stored,
      hiddenSlashCommands,
      piSettings,
    };

    const merged = {
      ...this.getDefaults(),
      ...stored,
      sharedEnvironmentVariables: getSharedEnvironmentVariables(providerSettings),
      envSnippets,
      hiddenSlashCommands,
      piSettings,
      chatViewPlacement,
    } as StoredObsiusSettings;

    updatePiAgentSettings(
      merged as unknown as Record<string, unknown>,
      getPiAgentSettings(providerSettings),
    );
    const modelReconciled = reconcileActiveModelFields(merged);

    if (
      modelReconciled
      ||
      JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || stored.chatViewPlacement !== chatViewPlacement
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredObsiusSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await this.adapter.write(OBSIUS_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(OBSIUS_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredObsiusSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  async setLastModel(model: string, isCustom: boolean): Promise<void> {
    if (isCustom) {
      await this.update({ lastCustomModel: model });
      return;
    }

    const current = await this.load();
    updatePiAgentSettings(
      current,
      { lastModel: model } as Partial<PiAgentSettings>,
    );
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updatePiAgentSettings(
      current,
      { environmentHash: hash } as Partial<PiAgentSettings>,
    );
    await this.save(current);
  }

  private getDefaults(): StoredObsiusSettings {
    return DEFAULT_OBSIUS_SETTINGS;
  }
}
