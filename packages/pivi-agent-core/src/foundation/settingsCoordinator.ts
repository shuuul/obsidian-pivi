import type { OpenSessionState } from './chat';
import type { ChatUIConfig } from './chatUi';
import {
  projectActiveChatState,
  reconcileTitleGenerationModelSelection,
} from './chatUiProjection';

export interface SettingsReconciliationResult {
  changed: boolean;
  invalidatedSessions: OpenSessionState[];
}

export function reconcileSettingsWithChatUi(
  settings: Record<string, unknown>,
  _sessions: OpenSessionState[],
  uiConfig: ChatUIConfig,
): SettingsReconciliationResult {
  const titleChanged = reconcileTitleGenerationModelSelection(settings, uiConfig);

  return {
    changed: titleChanged,
    invalidatedSessions: [],
  };
}

export function getProjectedSettingsSnapshot<T extends Record<string, unknown>>(
  settings: T,
  uiConfig: ChatUIConfig,
): T {
  const snapshot = { ...settings };
  projectActiveChatState(snapshot, uiConfig);
  return snapshot;
}

export function commitSettingsSnapshot(
  settings: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): void {
  Object.assign(settings, snapshot);
}
