import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageKey(message: AgentMessage): string {
  return JSON.stringify(message);
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is { type: 'text'; text: string } => (
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
    ))
    .map((block) => block.text)
    .join('');
}

export interface UserMessageEquivalence {
  existingText: string;
  incomingText: string;
}

export interface MissingAgentMessagesOptions {
  userMessageEquivalences?: UserMessageEquivalence[];
}

function userMessagesEqual(
  existingText: string,
  incomingText: string,
  options: MissingAgentMessagesOptions,
): boolean {
  if (existingText === incomingText) {
    return true;
  }
  return options.userMessageEquivalences?.some((equivalence) => (
    equivalence.existingText === existingText
    && equivalence.incomingText === incomingText
  )) ?? false;
}

function messagesEqual(
  left: AgentMessage,
  right: AgentMessage,
  options: MissingAgentMessagesOptions,
): boolean {
  if (isRecord(left) && isRecord(right) && left.role === 'user' && right.role === 'user') {
    return userMessagesEqual(textFromContent(left.content), textFromContent(right.content), options);
  }
  return messageKey(left) === messageKey(right);
}

function hasMatchingSuffixPrefix(
  existing: AgentMessage[],
  incoming: AgentMessage[],
  length: number,
  options: MissingAgentMessagesOptions,
): boolean {
  const offset = existing.length - length;
  for (let i = 0; i < length; i++) {
    const existingMessage = existing[offset + i];
    const incomingMessage = incoming[i];
    if (!existingMessage || !incomingMessage || !messagesEqual(existingMessage, incomingMessage, options)) {
      return false;
    }
  }
  return true;
}

function isToolResultMessage(message: AgentMessage): message is Message & { role: 'toolResult' } {
  return isRecord(message) && message.role === 'toolResult' && typeof message.toolCallId === 'string';
}

function isAssistantMessage(message: AgentMessage): message is Message & { role: 'assistant' } {
  return isRecord(message) && message.role === 'assistant' && Array.isArray(message.content);
}

function isLlmMessage(message: AgentMessage): message is Message {
  if (!isRecord(message)) {
    return false;
  }
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}

function convertContextSummaryMessage(message: AgentMessage): Message | null {
  if (!isRecord(message)) {
    return null;
  }
  if (message.role === 'compactionSummary' && typeof message.summary === 'string') {
    return {
      role: 'user',
      content: [{
        type: 'text',
        text: `<context_compaction_summary>\n${message.summary}\n</context_compaction_summary>`,
      }],
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    } as Message;
  }
  if (message.role === 'branchSummary' && typeof message.summary === 'string') {
    return {
      role: 'user',
      content: [{
        type: 'text',
        text: `<branch_summary>\n${message.summary}\n</branch_summary>`,
      }],
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    } as Message;
  }
  if (message.role === 'custom' && 'content' in message) {
    const content = typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : message.content;
    return {
      role: 'user',
      content,
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    } as Message;
  }
  return null;
}

function assistantToolCallIds(message: AgentMessage): string[] {
  if (!isAssistantMessage(message)) {
    return [];
  }
  return message.content
    .filter((block): block is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } => (
      isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string'
      && typeof block.name === 'string' && isRecord(block.arguments)
    ))
    .map((block) => block.id);
}

/**
 * Pi's agent_end event contains only messages produced by that run, while the
 * JSONL branch already contains the pre-persisted user prompt. Append only the
 * non-overlapping suffix so assistant tool calls and tool results stay paired.
 */
export function missingAgentMessages(
  existingContext: AgentMessage[],
  incomingMessages: AgentMessage[],
  options: MissingAgentMessagesOptions = {},
): AgentMessage[] {
  const maxOverlap = Math.min(existingContext.length, incomingMessages.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (hasMatchingSuffixPrefix(existingContext, incomingMessages, overlap, options)) {
      return incomingMessages.slice(overlap);
    }
  }
  return incomingMessages;
}

/** Drop restored tool results that no longer have a preceding assistant tool call. */
export function sanitizeAgentMessagesForLlm(messages: AgentMessage[]): Message[] {
  const sanitized: Message[] = [];
  let pendingToolCallIds = new Set<string>();

  for (const message of messages) {
    const contextSummary = convertContextSummaryMessage(message);
    if (contextSummary) {
      pendingToolCallIds = new Set();
      sanitized.push(contextSummary);
      continue;
    }

    if (!isLlmMessage(message)) {
      continue;
    }

    if (message.role === 'assistant') {
      pendingToolCallIds = new Set(assistantToolCallIds(message));
      sanitized.push(message);
      continue;
    }

    if (isToolResultMessage(message)) {
      if (!pendingToolCallIds.has(message.toolCallId)) {
        continue;
      }
      pendingToolCallIds.delete(message.toolCallId);
      sanitized.push(message);
      continue;
    }

    pendingToolCallIds = new Set();
    sanitized.push(message);
  }

  return sanitized;
}
