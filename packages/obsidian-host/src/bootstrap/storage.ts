import type { FileStore } from "@pivi/agent/ports";

import type { AppTabManagerState } from "./types";

export interface SharedAppStorage {
  initialize(): Promise<void>;
  loadRawPiviSettings(): Promise<Record<string, unknown> | null>;
  saveRawPiviSettings(stored: Record<string, unknown>): Promise<void>;
  savePiviSettings(settings: Record<string, unknown>): Promise<void>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  /**
   * Read leftover `data.json` deleted-session marks once, strip the key, and
   * return the live session paths so callers can move those JSONL files into
   * `.pivi/trash/sessions/`.
   */
  takeDeletedSessionFileQueue(): Promise<string[]>;
  getAdapter(): FileStore;
}
