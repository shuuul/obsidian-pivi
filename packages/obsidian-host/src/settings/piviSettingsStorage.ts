import {
  parseJsonObjectWithDiagnostics,
  preserveCorruptArtifact,
  runSerializedSave,
  writeFileAtomically,
} from '@pivi/agent/config/publication';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { FileStore } from "@pivi/agent/ports";
import { DEFAULT_PIVI_SETTINGS } from "@pivi/agent/settings/defaults";
import type { PersistedPiviSettings } from '@pivi/agent/settings/persistedPiviSettings';
import type { PiviSettings } from "@pivi/agent/settings/types";

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
    const parsed = parseJsonObjectWithDiagnostics(PIVI_SETTINGS_PATH, content);
    if (!parsed.ok) {
      await preserveCorruptArtifact(
        this.adapter,
        PIVI_SETTINGS_PATH,
        parsed.rawContent,
      );
      logger.warn('settings JSON is invalid; preserved corrupt artifact and using defaults');
      // Do not auto-save defaults over the corrupt source.
      return this.getDefaults();
    }

    const { settings, changed } = this.codec.normalize(parsed.value);
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
    const parsed = parseJsonObjectWithDiagnostics(PIVI_SETTINGS_PATH, content);
    if (!parsed.ok) {
      await preserveCorruptArtifact(
        this.adapter,
        PIVI_SETTINGS_PATH,
        parsed.rawContent,
      );
      logger.warn('settings JSON is invalid during raw load; preserved corrupt artifact');
      return null;
    }
    return parsed.value;
  }

  async saveRaw(stored: Record<string, unknown>): Promise<void> {
    const content = JSON.stringify(stored, null, 2);
    await runSerializedSave(PIVI_SETTINGS_PATH, async () => {
      await writeFileAtomically(this.adapter, PIVI_SETTINGS_PATH, content);
    });
  }

  async save(settings: StoredPiviSettings): Promise<void> {
    const stored: VaultPersistedPiviSettings = this.codec.prepareForSave?.(settings) ?? settings;
    const content = JSON.stringify(stored, null, 2);
    await runSerializedSave(PIVI_SETTINGS_PATH, async () => {
      await writeFileAtomically(this.adapter, PIVI_SETTINGS_PATH, content);
    });
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(PIVI_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredPiviSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  private getDefaults(): StoredPiviSettings {
    return this.codec.getDefaults();
  }
}
