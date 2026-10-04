import { projectActiveChatState, reconcileTitleGenerationModelSelection } from '@pivi/agent/runtime';
import { getProjectedSettingsSnapshot } from '@pivi/agent/settings';

import { piChatUIConfig } from './piChatUiConfig';

/** Clears a title-generation model that is no longer selectable. Returns whether settings changed. */
export function reconcilePiTitleGenerationModel(settings: Record<string, unknown>): boolean {
  return reconcileTitleGenerationModelSelection(settings, piChatUIConfig);
}

export function getPiSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T {
  return getProjectedSettingsSnapshot(settings, piChatUIConfig);
}

export function projectActivePiState(settings: Record<string, unknown>): void {
  projectActiveChatState(settings, piChatUIConfig);
}
