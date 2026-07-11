import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

export interface RewindContext {
  checkpointId: string | null | undefined;
  hasResponse: boolean;
}

export interface RedoContext {
  userIndex: number;
  checkpointId: string | null;
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
    const message = messages[i];
    if (!message) continue;
    if (message.role === 'user') break;
    if (getAssistantEntryId(message)) {
      hasResponse = true;
      break;
    }
  }

  if (userMessage.parentEntryId !== undefined) {
    return { checkpointId: userMessage.parentEntryId, hasResponse };
  }

  for (let i = userIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const assistantEntryId = getAssistantEntryId(message);
    if (assistantEntryId) {
      return { checkpointId: assistantEntryId, hasResponse };
    }
  }

  return { checkpointId: null, hasResponse };
}

export function findRedoContext(messages: ChatMessage[], assistantIndex: number): RedoContext | null {
  const assistantMessage = messages[assistantIndex];
  if (!assistantMessage || assistantMessage.role !== 'assistant') {
    return null;
  }

  for (let i = assistantIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user') {
      continue;
    }
    if (message.isInterrupt || message.isRebuiltContext) {
      continue;
    }

    const rewind = findRewindContext(messages, i);
    if (rewind.checkpointId === undefined) {
      return null;
    }
    return {
      userIndex: i,
      checkpointId: rewind.checkpointId,
    };
  }

  return null;
}
