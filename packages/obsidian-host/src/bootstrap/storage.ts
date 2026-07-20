import type { FileStore } from "@pivi/pivi-agent-core/ports";

import type { AppTabManagerState } from "./types";

/**
 * Minimal shared app storage contract.
 *
 * This interface covers only storage concerns shared by app orchestration:
 * Pivi settings, tab manager state, and the vault file adapter used by Pi
 * product services.
 */
export interface SharedAppStorage {
  initialize(): Promise<void>;
  loadRawPiviSettings(): Promise<Record<string, unknown> | null>;
  saveRawPiviSettings(stored: Record<string, unknown>): Promise<void>;
  savePiviSettings(settings: Record<string, unknown>): Promise<void>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  setDeletedSessionFiles(sessionFiles: string[]): Promise<void>;
  getDeletedSessionFiles(): Promise<string[]>;
  getAdapter(): FileStore;
}
