import type { OpenSessionState } from '../../foundation';
import {
  commitSettingsSnapshot as commitSettingsSnapshotWithChatUi,
  getProjectedSettingsSnapshot,
  projectActiveChatState,
  reconcileSettingsWithChatUi,
  reconcileTitleGenerationModelSelection,
  type SettingsReconciliationResult,
} from '../../foundation';
import { piChatUIConfig } from './piChatUiConfig';

export class PiSettingsCoordinator {
  static reconcileTitleGenerationModelSelection(
    settings: Record<string, unknown>,
  ): boolean {
    return reconcileTitleGenerationModelSelection(settings, piChatUIConfig);
  }

  static getSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T {
    return getProjectedSettingsSnapshot(settings, piChatUIConfig);
  }

  static commitSettingsSnapshot(
    settings: Record<string, unknown>,
    snapshot: Record<string, unknown>,
  ): void {
    commitSettingsSnapshotWithChatUi(settings, snapshot);
  }

  static reconcileSettings(
    settings: Record<string, unknown>,
    sessions: OpenSessionState[],
  ): SettingsReconciliationResult {
    return reconcileSettingsWithChatUi(settings, sessions, piChatUIConfig);
  }

  static projectActivePiState(settings: Record<string, unknown>): void {
    projectActiveChatState(settings, piChatUIConfig);
  }
}
