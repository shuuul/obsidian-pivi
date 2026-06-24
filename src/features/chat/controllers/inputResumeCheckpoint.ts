import type { ChatMessage } from '../../../core/types';

/**
 * Whether resume-at checkpoint is still the tail of the session.
 * If messages were added after the resume point, the checkpoint is stale.
 */
export function isResumeCheckpointStillNeeded(
  resumeMessageId: string,
  previousMessages: ChatMessage[],
): boolean {
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const message = previousMessages[i];
    if (message.role === 'assistant' && message.assistantMessageId === resumeMessageId) {
      return i === previousMessages.length - 1;
    }
  }
  return false;
}
