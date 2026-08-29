import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { DeletedSessionFileRecord, SharedAppStorage } from "../bootstrap/storage";
import type { AppTabManagerState } from "../bootstrap/types";
import {
  type PiviSettingsCodec,
  PiviSettingsStorage,
  type StoredPiviSettings,
} from "../settings/piviSettingsStorage";
import { ObsidianVaultFileAdapter } from "./obsidianVaultFileAdapter";

const PIVI_STORAGE_PATH = ".pivi";
const TAB_MANAGER_STATE_PATH = `${PIVI_STORAGE_PATH}/tab-manager-state.json`;
const logger = new PluginLogger('SharedStorageService');


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dedupeDeletedSessionRecords(
  records: readonly DeletedSessionFileRecord[],
): DeletedSessionFileRecord[] {
  return Array.from(
    new Map(records.map((record) => [record.sessionFile, record])).values(),
  );
}

function normalizeDeletedSessionFiles(
  value: unknown,
): { records: DeletedSessionFileRecord[]; changed: boolean } {
  if (!Array.isArray(value)) {
    return { records: [], changed: false };
  }
  const migratedAt = Date.now();
  let changed = false;
  const records = value.flatMap((entry): DeletedSessionFileRecord[] => {
    if (typeof entry === "string") {
      changed = true;
      return [{ sessionFile: entry, deletedAt: migratedAt }];
    }
    if (
      isRecord(entry)
      && typeof entry.sessionFile === "string"
      && typeof entry.deletedAt === "number"
      && Number.isFinite(entry.deletedAt)
    ) {
      return [{ sessionFile: entry.sessionFile, deletedAt: entry.deletedAt }];
    }
    changed = true;
    return [];
  });
  const normalized = dedupeDeletedSessionRecords(records);
  if (normalized.length !== records.length) {
    changed = true;
  }
  return { records: normalized, changed };
}

export type SharedStorageNoticeMessages = {
  failedSaveTabLayout: string;
  failedSaveDeletedSessions: string;
  failedSaveSyncedSettings: string;
};

const DEFAULT_STORAGE_NOTICES: SharedStorageNoticeMessages = {
  failedSaveTabLayout: "Failed to save tab layout",
  failedSaveDeletedSessions: "Failed to save deleted session list",
  failedSaveSyncedSettings:
    "Provider settings were saved on this device, but portable settings could not be written to the vault file.",
};

export class SharedStorageService implements SharedAppStorage {
  readonly piviSettings: PiviSettingsStorage;

  private adapter: ObsidianVaultFileAdapter;
  private plugin: Plugin;
  private notices: SharedStorageNoticeMessages;
  private pluginDataOperationTail: Promise<void> = Promise.resolve();

  constructor(
    plugin: Plugin,
    settingsCodec?: PiviSettingsCodec,
    notices?: Partial<SharedStorageNoticeMessages>,
  ) {
    this.plugin = plugin;
    this.adapter = new ObsidianVaultFileAdapter(plugin.app);
    this.piviSettings = new PiviSettingsStorage(this.adapter, settingsCodec);
    this.notices = { ...DEFAULT_STORAGE_NOTICES, ...notices };
  }

  async initialize(): Promise<void> {
    await this.ensureDirectories();
  }

  async loadRawPiviSettings(): Promise<Record<string, unknown> | null> {
    await this.ensureDirectories();
    return this.piviSettings.loadRaw();
  }

  async saveRawPiviSettings(stored: Record<string, unknown>): Promise<void> {
    await this.piviSettings.saveRaw(stored);
  }

  async savePiviSettings(settings: Record<string, unknown>): Promise<void> {
    try {
      await this.piviSettings.save(settings as StoredPiviSettings);
    } catch (error) {
      logger.warn('failed to save synced settings', error);
      new Notice(this.notices.failedSaveSyncedSettings);
      throw error;
    }
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    try {
      await this.writeTabManagerStateFile(state);
    } catch (error) {
      new Notice(this.notices.failedSaveTabLayout);
      throw error;
    }
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    const vaultState = await this.readTabManagerStateFile();
    if (vaultState) {
      return vaultState;
    }

    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      const legacyState = this.validateTabManagerState(data.tabManagerState);
      if (legacyState) {
        try {
          await this.writeTabManagerStateFile(legacyState);
          // Strip legacy key after successful vault write to avoid RMW races
          // with deletedSessionFiles on data.json.
          await this.clearLegacyTabManagerState();
        } catch (error) {
          // Legacy state still restores locally even if migration fails.
          logger.warn('failed to migrate legacy tab manager state', error);
        }
      }
      return legacyState;
    } catch (error) {
      logger.warn('failed to load tab manager state', error);
      return null;
    }
  }

  private async clearLegacyTabManagerState(): Promise<void> {
    try {
      await this.updatePluginData((data) => {
        delete data.tabManagerState;
      });
    } catch (error) {
      // Best-effort cleanup of legacy plugin data after vault migration.
      logger.warn('failed to clear legacy tab manager state', error);
    }
  }

  async setDeletedSessionFiles(records: DeletedSessionFileRecord[]): Promise<void> {
    try {
      await this.updatePluginData((data) => {
        data.deletedSessionFiles = dedupeDeletedSessionRecords(records);
      });
    } catch (error) {
      new Notice(this.notices.failedSaveDeletedSessions);
      throw error;
    }
  }

  async updateDeletedSessionFiles(
    update: (records: readonly DeletedSessionFileRecord[]) => DeletedSessionFileRecord[],
  ): Promise<void> {
    try {
      await this.runPluginDataOperation(async () => {
        const loaded: unknown = await this.plugin.loadData();
        const data = isRecord(loaded) ? loaded : {};
        const { records, changed } = normalizeDeletedSessionFiles(data.deletedSessionFiles);
        const next = dedupeDeletedSessionRecords(update(records));
        if (
          changed
          || next.length !== records.length
          || next.some((record, index) => {
            const previous = records[index];
            return !previous
              || previous.sessionFile !== record.sessionFile
              || previous.deletedAt !== record.deletedAt;
          })
        ) {
          data.deletedSessionFiles = next;
          await this.plugin.saveData(data);
        }
      });
    } catch (error) {
      new Notice(this.notices.failedSaveDeletedSessions);
      throw error;
    }
  }

  async getDeletedSessionFiles(): Promise<DeletedSessionFileRecord[]> {
    return this.runPluginDataOperation(async () => {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !Array.isArray(data.deletedSessionFiles)) {
        return [];
      }
      const { records, changed } = normalizeDeletedSessionFiles(data.deletedSessionFiles);
      if (changed) {
        data.deletedSessionFiles = records;
        await this.plugin.saveData(data);
      }
      return records;
    });
  }

  private runPluginDataOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pluginDataOperationTail.then(operation, operation);
    this.pluginDataOperationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private updatePluginData(update: (data: Record<string, unknown>) => void): Promise<void> {
    return this.runPluginDataOperation(async () => {
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      update(data);
      await this.plugin.saveData(data);
    });
  }

  getAdapter(): ObsidianVaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(PIVI_STORAGE_PATH);
    await this.adapter.ensureFolder(`${PIVI_STORAGE_PATH}/sessions`);
  }

  private async writeTabManagerStateFile(state: AppTabManagerState): Promise<void> {
    await this.adapter.write(
      TAB_MANAGER_STATE_PATH,
      `${JSON.stringify(state, null, 2)}\n`,
    );
  }

  private async readTabManagerStateFile(): Promise<AppTabManagerState | null> {
    try {
      return this.validateTabManagerState(
        JSON.parse(await this.adapter.read(TAB_MANAGER_STATE_PATH)),
      );
    } catch (error) {
      // Missing file and parse/IO failures both fall back to legacy plugin data.
      if (error instanceof Error && /ENOENT|not found|no such file/i.test(error.message)) {
        return null;
      }
      logger.warn('failed to load vault tab manager state', error);
      return null;
    }
  }

  private validateTabManagerState(data: unknown): AppTabManagerState | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    const state = data as Record<string, unknown>;
    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: AppTabManagerState["openTabs"] = [];
    for (const tab of state.openTabs) {
      if (!tab || typeof tab !== "object") {
        continue;
      }

      const tabObj = tab as Record<string, unknown>;
      if (typeof tabObj.tabId !== "string") {
        continue;
      }

      validatedTabs.push({
        tabId: tabObj.tabId,
        ...(typeof tabObj.sessionFile === "string"
          ? { sessionFile: tabObj.sessionFile }
          : {}),
        ...(typeof tabObj.leafId === "string"
          ? { leafId: tabObj.leafId }
          : tabObj.leafId === null
            ? { leafId: null }
            : {}),
        ...(typeof tabObj.draftModel === "string"
          ? { draftModel: tabObj.draftModel }
          : {}),
        ...(typeof tabObj.draftTitle === "string"
          ? { draftTitle: tabObj.draftTitle }
          : {}),
        ...(tabObj.isArchived === true ? { isArchived: true } : {}),
        ...(tabObj.needsAttention === true ? { needsAttention: true } : {}),
      });
    }

    return {
      openTabs: validatedTabs,
      activeTabId:
        typeof state.activeTabId === "string" ? state.activeTabId : null,
    };
  }
}
