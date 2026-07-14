import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

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
