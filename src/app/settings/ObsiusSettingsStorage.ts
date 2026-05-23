import { OBSIUS_SETTINGS_PATH } from '../../core/bootstrap/StoragePaths';
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

export { OBSIUS_SETTINGS_PATH };

export type StoredObsiusSettings = ObsiusSettings;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
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
  'openInMainTab',
  'settingsProvider',
  'savedProviderModel',
  'savedProviderEffort',
  'savedProviderServiceTier',
  'savedProviderThinkingBudget',
  'savedProviderPermissionMode',
  'providerConfigs',
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

function normalizePiSettings(stored: Record<string, unknown>): PiAgentSettings {
  if (isPiAgentSettings(stored.piSettings)) {
    return { ...stored.piSettings };
  }

  return {
    ...DEFAULT_PI_PROVIDER_SETTINGS,
    environmentVariables: DEFAULT_PI_PROVIDER_SETTINGS.environmentVariables,
  };
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

function hasLegacyFields(stored: Record<string, unknown>): boolean {
  return LEGACY_STRIPPED_SETTING_FIELDS.some((key) => key in stored);
}

function mergeLegacyHiddenSlashCommands(
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
    if (!(await this.adapter.exists(OBSIUS_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(OBSIUS_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const hiddenProviderCommands = mergeLegacyHiddenSlashCommands(
      normalizeHiddenProviderCommands(stored.hiddenProviderCommands),
      stored.hiddenSlashCommands,
    );
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const piSettings = normalizePiSettings(stored);
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

    updatePiProviderSettings(
      merged as unknown as Record<string, unknown>,
      getPiProviderSettings(legacyProviderSettings),
    );

    const didMigrateModels = migrateObsiusModelIds(merged as unknown as Record<string, unknown>);

    if (
      hasLegacyFields(stored)
      || shouldPersistChatViewPlacementMigration(stored, chatViewPlacement)
      || JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || didMigrateModels
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
    updatePiProviderSettings(
      current,
      { lastModel: model } as Partial<PiAgentSettings>,
    );
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updatePiProviderSettings(
      current,
      { environmentHash: hash } as Partial<PiAgentSettings>,
    );
    await this.save(current);
  }

  private getDefaults(): StoredObsiusSettings {
    return DEFAULT_OBSIUS_SETTINGS;
  }
}
