import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

export interface RewindContext {
  checkpointId: string | null | undefined;
  hasResponse: boolean;
}

export function getUserEntryId(message: ChatMessage): string | undefined {
  if (message.role !== 'user') return undefined;
  return message.userMessageId;
}

export function getAssistantEntryId(message: ChatMessage): string | undefined {
  if (message.role !== 'assistant') return undefined;
  return message.assistantMessageId;
}

export function findRewindContext(messages: ChatMessage[], userIndex: number): RewindContext {
  const userMessage = messages[userIndex];
  if (!userMessage || userMessage.role !== 'user') {
    return { checkpointId: undefined, hasResponse: false };
  }

  let hasResponse = false;
  for (let i = userIndex + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') break;
    if (getAssistantEntryId(messages[i])) {
      hasResponse = true;
      break;
    }
  }

  if (userMessage.parentEntryId !== undefined) {
    return { checkpointId: userMessage.parentEntryId, hasResponse };
  }

  for (let i = userIndex - 1; i >= 0; i--) {
    const assistantEntryId = getAssistantEntryId(messages[i]);
    if (assistantEntryId) {
      return { checkpointId: assistantEntryId, hasResponse };
    }
  }

  return { checkpointId: null, hasResponse };
}
