import { resolveUserMessageDisplayText } from '@pivi/agent/context/context';
import type { ChatMessage } from '@pivi/agent/runtime';

import { normalizeObsidianAppLinksInMarkdown } from '../../shared/utils/fileLink';

export function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

export function getMessageCopyContent(msg: ChatMessage): string {
  const content = (() => {
    if (msg.role === 'user') {
      return resolveUserMessageDisplayText(msg);
    }

    const textBlocks = msg.contentBlocks
      ?.filter((block): block is { type: 'text'; content: string } => block.type === 'text')
      .map((block) => block.content.trim())
      .filter((blockContent) => blockContent.length > 0);
    if (textBlocks && textBlocks.length > 0) {
      return textBlocks.join('\n\n');
    }
    return msg.content.trim();
  })();

  return normalizeObsidianAppLinksInMarkdown(content);
}

/** Serialize only the visible user/agent conversation through one completed agent turn. */
export function formatConversationAsMarkdown(
  messages: readonly ChatMessage[],
  throughMessageId: string,
): string {
  const throughIndex = messages.findIndex(message => message.id === throughMessageId);
  if (throughIndex < 0) return '';

  return messages
    .slice(0, throughIndex + 1)
    .filter(message => !message.isRebuiltContext)
    .map((message) => {
      const content = getMessageCopyContent(message);
      if (!content) return null;
      return `## ${message.role === 'user' ? 'User' : 'Agent'}\n\n${content}`;
    })
    .filter((section): section is string => section !== null)
    .join('\n\n');
}

export function getForkEntryId(msg: ChatMessage): string | undefined {
  return msg.role === 'user' ? msg.userMessageId : msg.assistantMessageId;
}

export function hasPendingAsyncSubagent(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant' || !msg.toolCalls?.length) {
    return false;
  }
  return msg.toolCalls.some((toolCall) => {
    const subagent = toolCall.subagent;
    if (subagent?.mode !== 'async') {
      return false;
    }
    const status = subagent.asyncStatus ?? subagent.status;
    return status === 'pending' || status === 'running';
  });
}
