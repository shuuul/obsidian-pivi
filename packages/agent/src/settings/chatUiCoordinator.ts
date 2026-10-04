import type { ChatUIConfig } from '../runtime/chatUi';
import { projectActiveChatState } from '../runtime/chatUiProjection';

export function getProjectedSettingsSnapshot<T extends Record<string, unknown>>(
  settings: T,
  uiConfig: ChatUIConfig,
): T {
  const snapshot = { ...settings };
  projectActiveChatState(snapshot, uiConfig);
  return snapshot;
}
