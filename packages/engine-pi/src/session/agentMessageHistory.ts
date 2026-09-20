import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message, ToolCall } from '@earendil-works/pi-ai';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read the message role without union narrowing. Pi 0.86 made ToolResultMessage
 * a conditional type, which breaks discriminant narrowing once AgentMessage is
 * intersected with Record; role comparisons here stay runtime-tolerant instead.
 */
function agentRole(message: AgentMessage): unknown {
  return isRecord(message) ? (message as Record<string, unknown>).role : undefined;
}

function recordValue(message: AgentMessage, key: string): unknown {
  return isRecord(message) ? (message as Record<string, unknown>)[key] : undefined;
}

interface PreparedAgentMessage {
  isUser: boolean;
  key: string | null;
  userText: string;
}

function prepareAgentMessage(message: AgentMessage): PreparedAgentMessage {
  if (agentRole(message) === 'user') {
    return {
      isUser: true,
      key: null,
      userText: textFromContent(recordValue(message, 'content')),
    };
  }
  return {
    isUser: false,
    key: JSON.stringify(message),
    userText: '',
  };
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

/** API-only availability XML must not create duplicate durable user rows. */
function stripExternalContextsXml(text: string): string {
  return text
    .replace(/\n\n<external_contexts>[\s\S]*?<\/external_contexts>/gi, '')
    .replace(/<external_contexts>[\s\S]*?<\/external_contexts>\s*/gi, '')
    .trimEnd();
}

function userMessagesEqual(
  existingText: string,
  incomingText: string,
  options: MissingAgentMessagesOptions,
): boolean {
  if (existingText === incomingText) {
    return true;
  }
  if (stripExternalContextsXml(existingText) === stripExternalContextsXml(incomingText)) {
    return true;
  }
  return options.userMessageEquivalences?.some((equivalence) => (
    equivalence.existingText === existingText
    && equivalence.incomingText === incomingText
  )) ?? false;
}

function preparedMessagesEqual(
  left: PreparedAgentMessage,
  right: PreparedAgentMessage,
  options: MissingAgentMessagesOptions,
): boolean {
  if (left.isUser && right.isUser) {
    return userMessagesEqual(left.userText, right.userText, options);
  }
  return left.key === right.key;
}

function hasMatchingSuffixPrefix(
  existing: PreparedAgentMessage[],
  incoming: PreparedAgentMessage[],
  length: number,
  options: MissingAgentMessagesOptions,
): boolean {
  const offset = existing.length - length;
  for (let i = 0; i < length; i++) {
    const existingMessage = existing[offset + i];
    const incomingMessage = incoming[i];
    if (!existingMessage || !incomingMessage || !preparedMessagesEqual(existingMessage, incomingMessage, options)) {
      return false;
    }
  }
  return true;
}

function isToolResultMessage(message: AgentMessage): message is AgentMessage & { role: 'toolResult' } {
  return agentRole(message) === 'toolResult' && typeof recordValue(message, 'toolCallId') === 'string';
}

function isAssistantMessage(message: AgentMessage): message is AgentMessage & { role: 'assistant' } {
  return agentRole(message) === 'assistant' && Array.isArray(recordValue(message, 'content'));
}

function isPendingAssistantMessage(message: AgentMessage): boolean {
  return isAssistantMessage(message) && recordValue(message, 'stopReason') === 'pending';
}

function isLlmMessage(message: AgentMessage): boolean {
  const role = agentRole(message);
  return role === 'user' || role === 'assistant' || role === 'toolResult';
}

function convertContextSummaryMessage(message: AgentMessage): Message | null {
  if (!isRecord(message)) {
    return null;
  }
  const role = agentRole(message);
  const timestamp = () => {
    const value = recordValue(message, 'timestamp');
    return typeof value === 'number' ? value : Date.now();
  };
  const summary = recordValue(message, 'summary');
  if (role === 'compactionSummary' && typeof summary === 'string') {
    return {
      role: 'user',
      content: [{
        type: 'text',
        text: `<context_compaction_summary>\n${summary}\n</context_compaction_summary>`,
      }],
      timestamp: timestamp(),
    };
  }
  if (role === 'branchSummary' && typeof summary === 'string') {
    return {
      role: 'user',
      content: [{
        type: 'text',
        text: `<branch_summary>\n${summary}\n</branch_summary>`,
      }],
      timestamp: timestamp(),
    };
  }
  if (role === 'custom' && 'content' in message) {
    const rawContent = recordValue(message, 'content');
    const content = typeof rawContent === 'string'
      ? [{ type: 'text' as const, text: rawContent }]
      : rawContent;
    return {
      role: 'user',
      content,
      timestamp: timestamp(),
    } as Message;
  }
  return null;
}

function assistantToolCallIds(message: AgentMessage): string[] {
  if (!isAssistantMessage(message)) {
    return [];
  }
  const content = recordValue(message, 'content');
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((block): block is ToolCall => (
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
  const existingPrepared = existingContext.map(prepareAgentMessage);
  const incomingPrepared = incomingMessages.map(prepareAgentMessage);
  const maxOverlap = Math.min(existingPrepared.length, incomingPrepared.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (hasMatchingSuffixPrefix(existingPrepared, incomingPrepared, overlap, options)) {
      return incomingMessages.slice(overlap).filter(message => !isPendingAssistantMessage(message));
    }
  }
  return incomingMessages.filter(message => !isPendingAssistantMessage(message));
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

    if (agentRole(message) === 'system') {
      // Pi 0.86 carries the system prompt and tool declarations as transcript
      // system messages, and the agent loop normalizes only convertToLlm
      // output, so system messages must survive LLM replay. Tool-pair state is
      // untouched: a synced tool delta may interleave between paired calls.
      sanitized.push(message as Message);
      continue;
    }

    if (!isLlmMessage(message)) {
      continue;
    }

    if (isAssistantMessage(message)) {
      const stopReason = recordValue(message, 'stopReason');
      if (stopReason === 'error' || stopReason === 'pending') {
        pendingToolCallIds = new Set();
        continue;
      }
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
    sanitized.push(message as Message);
  }

  return sanitized;
}
