import type { PersistedPiviSettings } from '@pivi/pivi-agent-core/foundation/persistedPiviSettings';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { AgentRuntimeSettings, PiviSettings } from "@pivi/pivi-agent-core/foundation/settings";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";
import type { FileStore } from "@pivi/pivi-agent-core/ports";

import { PIVI_SETTINGS_PATH } from "./storagePaths";

const logger = new PluginLogger('PiviSettingsStorage');

export { PIVI_SETTINGS_PATH };

/** In-memory runtime settings bag used by load/normalize and product code. */
export type StoredPiviSettings = PiviSettings;

/**
 * Vault JSON projection after device-local fields are stripped.
 * prepareForSave may return this narrower shape; JSON write accepts either.
 */
export type VaultPersistedPiviSettings = PersistedPiviSettings | StoredPiviSettings;

export interface PiviSettingsNormalizationResult {
  settings: StoredPiviSettings;
  changed: boolean;
}

export interface PiviSettingsCodec {
  getDefaults(): StoredPiviSettings;
  normalize(stored: Record<string, unknown>): PiviSettingsNormalizationResult;
  updateAgentSettings(
    settings: StoredPiviSettings,
    updates: Partial<AgentRuntimeSettings>,
  ): void;
  prepareForSave?(settings: StoredPiviSettings): VaultPersistedPiviSettings;
}

export const DEFAULT_PIVI_SETTINGS_CODEC: PiviSettingsCodec = {
  getDefaults() {
    return { ...DEFAULT_PIVI_SETTINGS };
  },
  normalize(stored) {
    return {
      settings: { ...DEFAULT_PIVI_SETTINGS, ...stored },
      changed: false,
    };
  },
  updateAgentSettings(settings, updates) {
    settings.agentSettings = {
      ...settings.agentSettings,
      ...updates,
    };
  },
};

export class PiviSettingsStorage {
  constructor(
    private adapter: FileStore,
    private codec: PiviSettingsCodec = DEFAULT_PIVI_SETTINGS_CODEC,
  ) {}

  async load(): Promise<StoredPiviSettings> {
    if (!(await this.adapter.exists(PIVI_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(PIVI_SETTINGS_PATH);
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      logger.warn('settings JSON is invalid; using defaults', error);
      return this.getDefaults();
    }

    const { settings, changed } = this.codec.normalize(stored);
    if (changed) {
      await this.save(settings);
    }

    return settings;
  }

  async loadRaw(): Promise<Record<string, unknown> | null> {
    if (!(await this.adapter.exists(PIVI_SETTINGS_PATH))) {
      return null;
    }

    const content = await this.adapter.read(PIVI_SETTINGS_PATH);
    try {
      const stored = JSON.parse(content) as unknown;
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return null;
      }
      return stored as Record<string, unknown>;
    } catch (error) {
      logger.warn('settings JSON is invalid during raw load', error);
      return null;
    }
  }

  async saveRaw(stored: Record<string, unknown>): Promise<void> {
    const content = JSON.stringify(stored, null, 2);
    await this.adapter.write(PIVI_SETTINGS_PATH, content);
  }

  async save(settings: StoredPiviSettings): Promise<void> {
    const stored: VaultPersistedPiviSettings = this.codec.prepareForSave?.(settings) ?? settings;
    const content = JSON.stringify(stored, null, 2);
    await this.adapter.write(PIVI_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(PIVI_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredPiviSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  async setLastModel(model: string): Promise<void> {
    const current = await this.load();
    this.codec.updateAgentSettings(current, {
      lastModel: model,
    });
    await this.save(current);
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    this.codec.updateAgentSettings(current, {
      environmentHash: hash,
    });
    await this.save(current);
  }

  private getDefaults(): StoredPiviSettings {
    return this.codec.getDefaults();
  }
}
