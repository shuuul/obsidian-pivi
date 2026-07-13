import type { ChatMessage, ContentBlock, SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { type ReactElement, useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import { ToolCallView, ToolStepGroupView } from './ToolCallView';
import { isGroupableToolCall, shouldRenderToolCall } from './toolPresentation';
import type { MessageContentAdapter, MessageContentAdapters } from './types';

export interface AssistantContentViewProps {
  readonly message: ChatMessage;
  readonly contentAdapters?: MessageContentAdapters;
}

export interface MessageContentSlotProps<Value> {
  readonly adapter: MessageContentAdapter<Value>;
  readonly value: Value;
  /** Changes whenever the immutable snapshot value has a new presentation generation. */
  readonly generation: string;
  readonly className: string;
}

/** React owns this element; an adapter may own only its empty children. */
export function MessageContentSlot<Value>({
  adapter,
  value,
  generation,
  className,
}: MessageContentSlotProps<Value>) {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) return;
    return adapter.mount(container, value, {
      generation,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
  }, [adapter, generation, value]);

  return <div ref={slotRef} className={className} />;
}

function toolForBlock(message: ChatMessage, toolId: string): ToolCallInfo | undefined {
  return message.toolCalls?.find(toolCall => toolCall.id === toolId);
}

function subagentForBlock(message: ChatMessage, subagentId: string): {
  toolCall: ToolCallInfo;
  subagent: SubagentInfo;
} | undefined {
  const toolCall = toolForBlock(message, subagentId)
    ?? message.toolCalls?.find(candidate => candidate.subagent?.id === subagentId);
  if (!toolCall?.subagent) return undefined;
  return { toolCall, subagent: toolCall.subagent };
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function TextBlockView({
  message,
  block,
  index,
  contentAdapters,
}: {
  readonly message: ChatMessage;
  readonly block: Extract<ContentBlock, { type: 'text' }>;
  readonly index: number;
  readonly contentAdapters?: MessageContentAdapters;
}) {
  if (!block.content.trim()) return null;
  const generation = `${message.id}:text:${index}:${block.content}`;
  if (contentAdapters?.markdown) {
    return (
      <MessageContentSlot
        adapter={contentAdapters.markdown}
        value={block.content}
        generation={generation}
        className="pivi-text-block"
      />
    );
  }
  return <div className="pivi-text-block">{block.content}</div>;
}

function ThinkingBlockView({
  block,
  contentAdapters,
  generation,
}: {
  readonly block: Extract<ContentBlock, { type: 'thinking' }>;
  readonly contentAdapters?: MessageContentAdapters;
  readonly generation: string;
}) {
  const t = useT();
  if (!block.content.trim()) return null;
  const seconds = block.durationSeconds === undefined ? null : Math.max(0, Math.round(block.durationSeconds));
  return (
    <details aria-label={t('chat.stream.thinkingExpandAria')} className="pivi-thinking-block">
      <summary className="pivi-thinking-header">
        <span className="pivi-thinking-label">
          {seconds === null ? t('chat.stream.thought') : t('chat.stream.thoughtFor', { seconds })}
        </span>
      </summary>
      {contentAdapters?.markdown
        ? <MessageContentSlot adapter={contentAdapters.markdown} className="pivi-thinking-content" generation={generation} value={block.content} />
        : <div className="pivi-thinking-content">{block.content}</div>}
    </details>
  );
}
function ContextCompactedView() {
  const t = useT();
  return <div className="pivi-compact-boundary"><span className="pivi-compact-boundary-label">{t('chat.stream.sessionCompacted')}</span></div>;
}

/** Exact pre-React visibility contract for assistant stored messages. */
export function messageHasVisibleAssistantContent(message: ChatMessage): boolean {
  if (message.content && message.content.trim().length > 0) return true;
  if (message.contentBlocks && message.contentBlocks.length > 0) {
    for (const block of message.contentBlocks) {
      if (block.type === 'thinking' && block.content.trim().length > 0) return true;
      if (block.type === 'text' && block.content.trim().length > 0) return true;
      if (block.type === 'context_compacted') return true;
      if (block.type === 'subagent') return true;
      if (block.type === 'tool_use') {
        const toolCall = message.toolCalls?.find(tc => tc.id === block.toolId);
        if (toolCall && shouldRenderToolCall(toolCall)) return true;
      }
    }
  }
  if (message.toolCalls?.some(toolCall => shouldRenderToolCall(toolCall))) return true;
  return false;
}

/** Data-plane equivalent of pre-React updateAssistantToolOnlyClass. */
export function isAssistantToolOnlyMessage(message: ChatMessage): boolean {
  const blocks = message.contentBlocks;
  let hasOrdinaryVisibleTool = false;
  let hasNonEmptyText = Boolean(message.content?.trim());
  let hasThinking = false;
  let hasSubagent = false;
  let hasCompactBoundary = false;

  if (blocks?.length) {
    for (const block of blocks) {
      if (block.type === 'text' && block.content.trim().length > 0) hasNonEmptyText = true;
      if (block.type === 'thinking' && block.content.trim().length > 0) hasThinking = true;
      if (block.type === 'context_compacted') hasCompactBoundary = true;
      if (block.type === 'subagent') hasSubagent = true;
      if (block.type === 'tool_use') {
        const toolCall = message.toolCalls?.find(tc => tc.id === block.toolId);
        if (!toolCall || !shouldRenderToolCall(toolCall)) continue;
        if (toolCall.subagent) {
          hasSubagent = true;
          continue;
        }
        hasOrdinaryVisibleTool = true;
      }
    }
  }

  for (const toolCall of message.toolCalls ?? []) {
    if (!shouldRenderToolCall(toolCall)) continue;
    if (toolCall.subagent) {
      hasSubagent = true;
      continue;
    }
    hasOrdinaryVisibleTool = true;
  }

  const hasResponseFooter = Boolean(message.durationSeconds && message.durationSeconds > 0 && !hasCompactBoundary);
  return hasOrdinaryVisibleTool
    && !hasNonEmptyText
    && !hasThinking
    && !hasSubagent
    && !hasResponseFooter
    && !hasCompactBoundary;
}

/** Ordered assistant block presentation. contentBlocks are authoritative; toolCalls are resolved by id only. */
export function AssistantContentView({ message, contentAdapters }: AssistantContentViewProps) {
  const t = useT();
  const blocks = message.contentBlocks;
  const renderedToolIds = new Set<string>();
  const content: ReactElement[] = [];

  if (blocks?.length) {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (!block) continue;
      const key = `${message.id}:${index}:${block.type}`;
      switch (block.type) {
        case 'text':
          content.push(<TextBlockView key={key} message={message} block={block} index={index} contentAdapters={contentAdapters} />);
          break;
        case 'thinking':
          content.push(<ThinkingBlockView key={key} block={block} contentAdapters={contentAdapters} generation={`${message.id}:thinking:${index}:${block.content}`} />);
          break;
        case 'tool_use': {
          const toolCall = toolForBlock(message, block.toolId);
          if (!toolCall || !shouldRenderToolCall(toolCall)) break;
          const grouped = [toolCall];
          let cursor = index + 1;
          if (isGroupableToolCall(toolCall)) {
            while (cursor < blocks.length) {
              const candidate = blocks[cursor];
              if (!candidate || candidate.type !== 'tool_use') break;
              const candidateTool = toolForBlock(message, candidate.toolId);
              if (!candidateTool || !shouldRenderToolCall(candidateTool) || !isGroupableToolCall(candidateTool)) break;
              grouped.push(candidateTool);
              cursor++;
            }
          }
          grouped.forEach(item => renderedToolIds.add(item.id));
          if (grouped.length > 1) {
            content.push(<ToolStepGroupView contentAdapters={contentAdapters} key={key} toolCalls={grouped} />);
            index = cursor - 1;
          } else {
            content.push(<ToolCallView key={key} toolCall={toolCall} contentAdapters={contentAdapters} />);
          }
          break;
        }
        case 'subagent': {
          const resolved = subagentForBlock(message, block.subagentId);
          if (!resolved) break;
          renderedToolIds.add(resolved.toolCall.id);
          content.push(<ToolCallView key={key} toolCall={resolved.toolCall} contentAdapters={contentAdapters} />);
          break;
        }
        case 'context_compacted':
          content.push(<ContextCompactedView key={key} />);
          break;
      }
    }
  } else if (message.content) {
    content.push(<TextBlockView key={`${message.id}:legacy-text`} message={message} block={{ type: 'text', content: message.content }} index={0} contentAdapters={contentAdapters} />);
  }

  for (const toolCall of message.toolCalls ?? []) {
    if (renderedToolIds.has(toolCall.id) || !shouldRenderToolCall(toolCall)) continue;
    content.push(<ToolCallView key={`${message.id}:orphan:${toolCall.id}`} toolCall={toolCall} contentAdapters={contentAdapters} />);
  }

  const hasCompactBoundary = blocks?.some(block => block.type === 'context_compacted') ?? false;
  if (message.durationSeconds && message.durationSeconds > 0 && !hasCompactBoundary) {
    content.push(
      <div className="pivi-response-footer" key={`${message.id}:duration`}>
        <span className="pivi-baked-duration pivi-response-meta">
          {t('chat.stream.responseDuration', { flavor: message.durationFlavorWord ?? t('chat.stream.defaultDurationFlavor'), duration: formatDuration(message.durationSeconds) })}
        </span>
      </div>,
    );
  }

  return <>{content}</>;
}
