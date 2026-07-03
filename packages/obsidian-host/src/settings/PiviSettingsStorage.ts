import type { AgentRuntimeSettings, PiviSettings } from "@pivi/pivi-agent-core/foundation/settings";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/pivi-agent-core/foundation/settingsDefaults";

import type { FileStore } from "../FileStore";
import { PIVI_SETTINGS_PATH } from "./storagePaths";

export { PIVI_SETTINGS_PATH };

export type StoredPiviSettings = PiviSettings;

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
      console.warn("Pivi: settings JSON is invalid; using defaults", error);
      return this.getDefaults();
    }

    const { settings, changed } = this.codec.normalize(stored);
    if (changed) {
      await this.save(settings);
    }

    return settings;
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
