import type { ChatState } from '../state/ChatState';

export function closeStreamingToolStepGroup(state: ChatState): void {
  state.streamingToolStepGroup = null;
}
