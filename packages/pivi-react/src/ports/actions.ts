import type { EditorSelectionToolbarSettings } from '@pivi/agent/settings/types';

import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
  SettingsUiSnapshotData,
} from '../settings/types';

export interface SettingsSnapshotPort {
  getSnapshot(): SettingsUiSnapshotData;
}

export interface SessionMaintenanceSnapshot {
  readonly archivedCount: number;
  readonly deletedCount: number;
}

export interface DeleteArchivedResult {
  readonly moved: number;
  readonly skippedActive: number;
  readonly failed: number;
}

export interface SettingsActionsPort {
  saveGeneral(patch: Partial<SettingsGeneralSnapshot>): Promise<void>;
  saveSubagents(patch: Partial<SettingsSubagentsSnapshot>): Promise<void>;
  saveEditorSelectionToolbar(settings: EditorSelectionToolbarSettings): Promise<void>;
  loadSessionMaintenance(): Promise<SessionMaintenanceSnapshot>;
  deleteAllArchivedChats(): Promise<DeleteArchivedResult>;
  purgeDeletedSessionFiles(): Promise<number>;
}
