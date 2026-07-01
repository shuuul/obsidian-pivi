import type { FileStore } from "../storage/FileStore";
import type { AppTabManagerState } from "./types";

/**
 * Minimal shared app storage contract.
 *
 * This interface covers only storage concerns shared by app orchestration:
 * Pivi settings, tab manager state, and the vault file adapter used by Pi
 * product services.
 */
export interface SharedAppStorage {
  initialize(): Promise<{ pivi: Record<string, unknown> }>;
  savePiviSettings(settings: Record<string, unknown>): Promise<void>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  getAdapter(): FileStore;
}
