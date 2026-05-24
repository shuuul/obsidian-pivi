import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import type { ChatMessage, StreamChunk } from '../../../core/types';
import type { TabData } from './types';

export function generateTabMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

export function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

/** Render a background auto-turn after the main stream handler completes. */
export async function renderAutoTriggeredTurn(tab: TabData, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) {
    return;
  }

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateTabMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.obsius2-message-content');
    if (contentEl) {
      if (!previousContentEl) {
        tab.state.toolCallElements.clear();
      }
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}
