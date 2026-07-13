import type { Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { SharedAppStorage } from "../bootstrap/storage";
import type { AppTabManagerState } from "../bootstrap/types";
import {
  type PiviSettingsCodec,
  PiviSettingsStorage,
  type StoredPiviSettings,
} from "../settings/piviSettingsStorage";
import { ObsidianVaultFileAdapter } from "./obsidianVaultFileAdapter";

const PIVI_STORAGE_PATH = ".pivi";
const TAB_MANAGER_STATE_PATH = `${PIVI_STORAGE_PATH}/tab-manager-state.json`;


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export type SharedStorageNoticeMessages = {
  failedSaveTabLayout: string;
  failedSaveDeletedSessions: string;
};

const DEFAULT_STORAGE_NOTICES: SharedStorageNoticeMessages = {
  failedSaveTabLayout: "Failed to save tab layout",
  failedSaveDeletedSessions: "Failed to save deleted session list",
};

export class SharedStorageService implements SharedAppStorage {
  readonly piviSettings: PiviSettingsStorage;

  private adapter: ObsidianVaultFileAdapter;
  private plugin: Plugin;
  private notices: SharedStorageNoticeMessages;

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

  async initialize(): Promise<{ pivi: Record<string, unknown> }> {
    await this.ensureDirectories();
    const pivi = await this.piviSettings.load();
    return { pivi };
  }

  async savePiviSettings(settings: Record<string, unknown>): Promise<void> {
    await this.piviSettings.save(settings as StoredPiviSettings);
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    try {
      await this.writeTabManagerStateFile(state);
    } catch {
      new Notice(this.notices.failedSaveTabLayout);
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
          console.warn('Pivi: failed to migrate legacy tab manager state', error);
        }
      }
      return legacyState;
    } catch (error) {
      console.warn("Pivi: failed to load tab manager state", error);
      return null;
    }
  }

  private async clearLegacyTabManagerState(): Promise<void> {
    try {
      const loaded: unknown = await this.plugin.loadData();
      if (!isRecord(loaded) || !("tabManagerState" in loaded)) {
        return;
      }
      delete loaded.tabManagerState;
      await this.plugin.saveData(loaded);
    } catch (error) {
      // Best-effort cleanup of legacy plugin data after vault migration.
      console.warn('Pivi: failed to clear legacy tab manager state', error);
    }
  }

  async setDeletedSessionFiles(sessionFiles: string[]): Promise<void> {
    try {
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.deletedSessionFiles = Array.from(new Set(sessionFiles));
      await this.plugin.saveData(data);
    } catch {
      new Notice(this.notices.failedSaveDeletedSessions);
    }
  }

  async getDeletedSessionFiles(): Promise<string[]> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !Array.isArray(data.deletedSessionFiles)) {
        return [];
      }
      return data.deletedSessionFiles.filter((sessionFile): sessionFile is string => typeof sessionFile === "string");
    } catch (error) {
      console.warn("Pivi: failed to load deleted session list", error);
      return [];
    }
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
      console.warn("Pivi: failed to load vault tab manager state", error);
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
