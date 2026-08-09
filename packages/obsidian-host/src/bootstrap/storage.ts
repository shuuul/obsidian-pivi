import type { FileStore } from "@pivi/agent/ports";

import type { AppTabManagerState } from "./types";

export interface DeletedSessionFileRecord {
  sessionFile: string;
  deletedAt: number;
}

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
  setDeletedSessionFiles(records: DeletedSessionFileRecord[]): Promise<void>;
  /**
   * Atomically read-modify-write the deleted-session recovery queue inside one
   * serialized plugin-data operation so concurrent mark/restore/purge cannot
   * drop each other's records via separated get + set.
   */
  updateDeletedSessionFiles(
    update: (records: readonly DeletedSessionFileRecord[]) => DeletedSessionFileRecord[],
  ): Promise<void>;
  getDeletedSessionFiles(): Promise<DeletedSessionFileRecord[]>;
  getAdapter(): FileStore;
}
