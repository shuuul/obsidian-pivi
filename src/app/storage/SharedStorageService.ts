import type { Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { AppTabManagerState } from "../../pi/agent/types";
import type { SharedAppStorage } from "../../pi/bootstrap/storage";
import { PIVI_STORAGE_PATH } from "../../pi/bootstrap/StoragePaths";
import {
  PiviSettingsStorage,
  type StoredPiviSettings,
} from "../settings/PiviSettingsStorage";
import { ObsidianVaultFileAdapter } from "./ObsidianVaultFileAdapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly piviSettings: PiviSettingsStorage;

  private adapter: ObsidianVaultFileAdapter;
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new ObsidianVaultFileAdapter(plugin.app);
    this.piviSettings = new PiviSettingsStorage(this.adapter);
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
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.tabManagerState = state;
      await this.plugin.saveData(data);
    } catch {
      new Notice("Failed to save tab layout");
    }
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return this.validateTabManagerState(data.tabManagerState);
    } catch (error) {
      console.warn("Pivi: failed to load tab manager state", error);
      return null;
    }
  }

  getAdapter(): ObsidianVaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(PIVI_STORAGE_PATH);
    await this.adapter.ensureFolder(`${PIVI_STORAGE_PATH}/sessions`);
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
      });
    }

    return {
      openTabs: validatedTabs,
      activeTabId:
        typeof state.activeTabId === "string" ? state.activeTabId : null,
    };
  }
}
