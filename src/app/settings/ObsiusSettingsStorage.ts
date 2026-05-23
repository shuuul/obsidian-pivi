import {
  LEGACY_OBSIUS_SETTINGS_PATH,
  OBSIUS_SETTINGS_PATH,
} from '../../core/bootstrap/StoragePaths';
import {
  normalizeHiddenCommandList,
  normalizeHiddenProviderCommands,
} from '../../core/providers/commands/hiddenCommands';
import { migrateObsiusModelIds } from '../../core/providers/modelId';
import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type EnvironmentScope,
  type EnvSnippet,
  type HiddenProviderCommands,
  type ObsiusSettings,
  type PiAgentSettings,
} from '../../core/types/settings';
import { DEFAULT_PI_PROVIDER_SETTINGS } from '../../providers/pi/settings';
import {
  getPiProviderSettings,
  updatePiProviderSettings,
} from '../../providers/pi/settings';
import { DEFAULT_OBSIUS_SETTINGS } from './defaultSettings';

export {
  LEGACY_OBSIUS_SETTINGS_PATH,
  OBSIUS_SETTINGS_PATH,
};

export type StoredObsiusSettings = ObsiusSettings;

const LEGACY_TOP_LEVEL_PROVIDER_FIELDS = [
  'claudeSafeMode',
  'codexSafeMode',
  'claudeCliPath',
  'claudeCliPathsByHost',
  'codexCliPath',
  'codexCliPathsByHost',
  'codexReasoningSummary',
  'loadUserClaudeSettings',
  'codexEnabled',
  'lastClaudeModel',
  'enableBangBash',
  'environmentVariables',
  'lastEnvHash',
  'lastCodexEnvHash',
] as const;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
  ...LEGACY_TOP_LEVEL_PROVIDER_FIELDS,
  'openInMainTab',
] as const;

function stripLegacyFields(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const key of LEGACY_STRIPPED_SETTING_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(
  value: unknown,
  legacyOpenInMainTab: unknown,
): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  if (typeof legacyOpenInMainTab === 'boolean') {
    return legacyOpenInMainTab ? 'main-tab' : 'right-sidebar';
  }

  return DEFAULT_OBSIUS_SETTINGS.chatViewPlacement;
}

function shouldPersistChatViewPlacementMigration(
  stored: Record<string, unknown>,
  normalized: ChatViewPlacement,
): boolean {
  return 'openInMainTab' in stored
    || (
      'chatViewPlacement' in stored
      && stored.chatViewPlacement !== normalized
    );
}

function isPiAgentSettings(value: unknown): value is PiAgentSettings {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function migrateProviderConfigsToPiSettings(stored: Record<string, unknown>): {
  piSettings: PiAgentSettings;
  migrated: boolean;
} {
  if (isPiAgentSettings(stored.piSettings)) {
    return { piSettings: { ...stored.piSettings }, migrated: false };
  }

  const legacyConfigs = stored.providerConfigs;
  const legacyPi = legacyConfigs
    && typeof legacyConfigs === 'object'
    && !Array.isArray(legacyConfigs)
    && isPiAgentSettings((legacyConfigs as Record<string, unknown>).pi)
    ? (legacyConfigs as Record<string, PiAgentSettings>).pi
    : null;

  const piSettings: PiAgentSettings = legacyPi
    ? { ...legacyPi }
    : {
      ...DEFAULT_PI_PROVIDER_SETTINGS,
      environmentVariables: DEFAULT_PI_PROVIDER_SETTINGS.environmentVariables,
    };

  return { piSettings, migrated: true };
}

function stripLegacyProviderProjectionFields(settings: Record<string, unknown>): void {
  delete settings.settingsProvider;
  delete settings.savedProviderModel;
  delete settings.savedProviderEffort;
  delete settings.savedProviderServiceTier;
  delete settings.savedProviderThinkingBudget;
  delete settings.savedProviderPermissionMode;
  delete settings.providerConfigs;
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || (typeof value === 'string' && value.startsWith('provider:'));
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
        isEnvironmentScope(candidate.scope)
          ? candidate.scope
          : inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
    });
  }

  return snippets;
}

function hasLegacyTopLevelProviderFields(stored: Record<string, unknown>): boolean {
  return LEGACY_TOP_LEVEL_PROVIDER_FIELDS.some((key) => key in stored);
}

function mergeLegacyClaudeHiddenCommands(
  hiddenProviderCommands: HiddenProviderCommands,
  legacyHiddenSlashCommands: unknown,
): HiddenProviderCommands {
  const legacyCommands = normalizeHiddenCommandList(legacyHiddenSlashCommands);
  if (legacyCommands.length === 0 || hiddenProviderCommands.pi) {
    return hiddenProviderCommands;
  }

  return {
    ...hiddenProviderCommands,
    pi: legacyCommands,
  };
}

export class ObsiusSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredObsiusSettings> {
    const settingsPath = await this.getLoadPath();
    if (!settingsPath) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(settingsPath);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const hiddenProviderCommands = mergeLegacyClaudeHiddenCommands(
      normalizeHiddenProviderCommands(stored.hiddenProviderCommands),
      stored.hiddenSlashCommands,
    );
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const { piSettings, migrated: migratedPiSettings } = migrateProviderConfigsToPiSettings(stored);
    const chatViewPlacement = normalizeChatViewPlacement(
      stored.chatViewPlacement,
      stored.openInMainTab,
    );
    const legacyProviderSettings = {
      ...stored,
      hiddenProviderCommands,
      piSettings,
    };
    const storedWithoutLegacy = stripLegacyFields({
      ...legacyProviderSettings,
    });

    const legacyNormalized = {
      ...storedWithoutLegacy,
      sharedEnvironmentVariables: getSharedEnvironmentVariables(legacyProviderSettings),
      envSnippets,
      hiddenProviderCommands,
      piSettings,
      chatViewPlacement,
    };

    const merged = {
      ...this.getDefaults(),
      ...legacyNormalized,
    } as StoredObsiusSettings;

    stripLegacyProviderProjectionFields(merged as unknown as Record<string, unknown>);
    updatePiProviderSettings(
      merged as unknown as Record<string, unknown>,
      getPiProviderSettings(legacyProviderSettings),
    );

    const didMigrateModels = migrateObsiusModelIds(merged as unknown as Record<string, unknown>);
    const hadLegacyProjectionFields = (
      'settingsProvider' in stored
      || 'savedProviderModel' in stored
      || 'providerConfigs' in stored
    );

    if (
      settingsPath !== OBSIUS_SETTINGS_PATH
      || (
      hasLegacyTopLevelProviderFields(stored)
      || 'show1MModel' in stored
      || 'slashCommands' in stored
      || 'hiddenSlashCommands' in stored
      || 'activeConversationId' in stored
      || 'allowExternalAccess' in stored
      || 'allowedExportPaths' in stored
      || 'enableBlocklist' in stored
      || 'blockedCommands' in stored
      || shouldPersistChatViewPlacementMigration(stored, chatViewPlacement)
      || JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || migratedPiSettings
      || didMigrateModels
      || hadLegacyProjectionFields
      )
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredObsiusSettings): Promise<void> {
    const content = JSON.stringify(
      stripLegacyFields(settings),
      null,
      2,
    );
    await this.adapter.write(OBSIUS_SETTINGS_PATH, content);
    await this.deleteLegacyFileIfPresent();
  }

  async exists(): Promise<boolean> {
    if (await this.adapter.exists(OBSIUS_SETTINGS_PATH)) {
      return true;
    }

    return this.adapter.exists(LEGACY_OBSIUS_SETTINGS_PATH);
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
    updatePiProviderSettings(
      current,
      { lastModel: model } as any,
    );
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updatePiProviderSettings(
      current,
      { environmentHash: hash } as any,
    );
    await this.save(current);
  }

  private getDefaults(): StoredObsiusSettings {
    return DEFAULT_OBSIUS_SETTINGS;
  }

  private async getLoadPath(): Promise<string | null> {
    if (await this.adapter.exists(OBSIUS_SETTINGS_PATH)) {
      return OBSIUS_SETTINGS_PATH;
    }

    if (await this.adapter.exists(LEGACY_OBSIUS_SETTINGS_PATH)) {
      return LEGACY_OBSIUS_SETTINGS_PATH;
    }

    return null;
  }

  private async deleteLegacyFileIfPresent(): Promise<void> {
    if (await this.adapter.exists(LEGACY_OBSIUS_SETTINGS_PATH)) {
      await this.adapter.delete(LEGACY_OBSIUS_SETTINGS_PATH);
    }
  }
}
