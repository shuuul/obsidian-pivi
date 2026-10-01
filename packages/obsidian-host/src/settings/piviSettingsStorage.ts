import {
  parseJsonObjectWithDiagnostics,
  preserveCorruptArtifact,
  runSerializedSave,
  writeFileAtomically,
} from '@pivi/agent/config/publication';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { FileStore } from "@pivi/agent/ports";
import type { PersistedPiviSettings } from '@pivi/agent/settings/persistedPiviSettings';
import type { PiviSettings } from "@pivi/agent/settings/types";

import { PIVI_SETTINGS_PATH } from "./storagePaths";

const logger = new PluginLogger('PiviSettingsStorage');

export { PIVI_SETTINGS_PATH };

/** In-memory runtime settings bag used by product code. */
export type StoredPiviSettings = PiviSettings;

/**
 * Vault JSON projection after device-local fields are stripped.
 * prepareForSave may return this narrower shape; JSON write accepts either.
 */
export type VaultPersistedPiviSettings = PersistedPiviSettings | StoredPiviSettings;

/** Projects runtime settings onto the synced vault file before each save. */
export interface PiviSettingsCodec {
  prepareForSave(settings: StoredPiviSettings): VaultPersistedPiviSettings;
}

export class PiviSettingsStorage {
  constructor(
    private adapter: FileStore,
    private codec?: PiviSettingsCodec,
  ) {}

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
    const stored: VaultPersistedPiviSettings = this.codec?.prepareForSave(settings) ?? settings;
    const content = JSON.stringify(stored, null, 2);
    await runSerializedSave(PIVI_SETTINGS_PATH, async () => {
      await writeFileAtomically(this.adapter, PIVI_SETTINGS_PATH, content);
    });
  }
}
