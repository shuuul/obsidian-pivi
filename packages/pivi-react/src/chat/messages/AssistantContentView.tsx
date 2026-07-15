import type { ChatMessage, ContentBlock, SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { memo, type ReactElement, useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import {
  type ChatProjectionStore,
  getChatProjectionBlockId,
  useChatProjectionBlock,
} from '../../store';
import { MemoryBoundary } from './MemoryBoundary';
import { ToolCallView, ToolStepGroupView } from './ToolCallView';
import { isGroupableToolCall, shouldRenderToolCall } from './toolPresentation';
import type { MessageContentAdapter, MessageContentAdapters } from './types';

export interface AssistantContentViewProps {
  readonly message: ChatMessage;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming?: boolean;
  readonly projectionStore?: ChatProjectionStore;
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
  const latestValueRef = useRef(value);
  const mountedValueRef = useRef<Value | null>(null);
  latestValueRef.current = value;

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const initialValue = latestValueRef.current;
    mountedValueRef.current = initialValue;
    const dispose = adapter.mount(container, initialValue, {
      generation,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
    return () => {
      mountedValueRef.current = null;
      dispose?.();
    };
  }, [adapter, generation]);

  useEffect(() => {
    const container = slotRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow || mountedValueRef.current === value) return;
    mountedValueRef.current = value;
    adapter.update?.(container, value, {
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
  messageId,
  block,
  index,
  contentAdapters,
  isStreaming,
}: {
  readonly messageId: string;
  readonly block: Extract<ContentBlock, { type: 'text' }>;
  readonly index: number;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming: boolean;
}) {
  if (!block.content.trim()) return null;
  const generation = `${messageId}:text:${index}`;
  if (contentAdapters?.markdown) {
    return (
      <MessageContentSlot
        adapter={contentAdapters.markdown}
        value={{ blockId: generation, content: block.content, phase: isStreaming ? 'streaming' : 'terminal' }}
        generation={generation}
        className="pivi-text-block"
      />
    );
  }
  return <div className="pivi-text-block">{block.content}</div>;
}

const SubscribedTextBlockView = memo(function SubscribedTextBlockView({
  blockId,
  contentAdapters,
  isStreaming,
  store,
}: {
  readonly blockId: string;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming: boolean;
  readonly store: ChatProjectionStore;
}) {
  const entity = useChatProjectionBlock(store, blockId);
  if (!entity || entity.block.type !== 'text') return null;
  return (
    <TextBlockView
      block={entity.block}
      contentAdapters={contentAdapters}
      index={entity.index}
      isStreaming={isStreaming}
      messageId={entity.messageId}
    />
  );
});

function ThinkingBlockView({
  block,
  contentAdapters,
  generation,
  isStreaming,
}: {
  readonly block: Extract<ContentBlock, { type: 'thinking' }>;
  readonly contentAdapters?: MessageContentAdapters;
  readonly generation: string;
  readonly isStreaming: boolean;
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
        ? <MessageContentSlot adapter={contentAdapters.markdown} className="pivi-thinking-content" generation={generation} value={{ blockId: generation, content: block.content, phase: isStreaming ? 'streaming' : 'terminal' }} />
        : <div className="pivi-thinking-content">{block.content}</div>}
    </details>
  );
}

const SubscribedThinkingBlockView = memo(function SubscribedThinkingBlockView({
  blockId,
  contentAdapters,
  isStreaming,
  store,
}: {
  readonly blockId: string;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming: boolean;
  readonly store: ChatProjectionStore;
}) {
  const entity = useChatProjectionBlock(store, blockId);
  if (!entity || entity.block.type !== 'thinking') return null;
  return (
    <ThinkingBlockView
      block={entity.block}
      contentAdapters={contentAdapters}
      generation={`${entity.messageId}:thinking:${entity.index}`}
      isStreaming={isStreaming}
    />
  );
});
function ContextCompactedView({ block }: {
  readonly block: Extract<ContentBlock, { type: 'context_compacted' }>;
}) {
  return (
    <MemoryBoundary
      checkpoint={block.checkpoint}
      kind="compaction"
      summary={block.summary}
      tokensAfter={block.tokensAfter}
      tokensBefore={block.tokensBefore}
    />
  );
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
export function AssistantContentView({ message, contentAdapters, isStreaming = false, projectionStore }: AssistantContentViewProps) {
  const t = useT();
  const blocks = message.contentBlocks;
  const renderedToolIds = new Set<string>();
  const content: ReactElement[] = [];

  if (blocks?.length) {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (!block) continue;
      const key = `${message.id}:${index}:${block.type}`;
      const blockId = getChatProjectionBlockId(message.id, index);
      switch (block.type) {
        case 'text':
          content.push(projectionStore
            ? <SubscribedTextBlockView blockId={blockId} contentAdapters={contentAdapters} isStreaming={isStreaming} key={key} store={projectionStore} />
            : <TextBlockView key={key} messageId={message.id} block={block} index={index} contentAdapters={contentAdapters} isStreaming={isStreaming} />);
          break;
        case 'thinking':
          content.push(projectionStore
            ? <SubscribedThinkingBlockView blockId={blockId} contentAdapters={contentAdapters} isStreaming={isStreaming} key={key} store={projectionStore} />
            : <ThinkingBlockView key={key} block={block} contentAdapters={contentAdapters} generation={`${message.id}:thinking:${index}`} isStreaming={isStreaming} />);
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
            content.push(projectionStore
              ? <ToolStepGroupView contentAdapters={contentAdapters} key={key} projectionStore={projectionStore} toolIds={grouped.map(item => item.id)} />
              : <ToolStepGroupView contentAdapters={contentAdapters} key={key} toolCalls={grouped} />);
            index = cursor - 1;
          } else {
            content.push(projectionStore
              ? <ToolCallView key={key} toolId={toolCall.id} projectionStore={projectionStore} contentAdapters={contentAdapters} />
              : <ToolCallView key={key} toolCall={toolCall} contentAdapters={contentAdapters} />);
          }
          break;
        }
        case 'subagent': {
          const resolved = subagentForBlock(message, block.subagentId);
          if (!resolved) break;
          renderedToolIds.add(resolved.toolCall.id);
          content.push(projectionStore
            ? <ToolCallView key={key} toolId={resolved.toolCall.id} projectionStore={projectionStore} contentAdapters={contentAdapters} />
            : <ToolCallView key={key} toolCall={resolved.toolCall} contentAdapters={contentAdapters} />);
          break;
        }
        case 'context_compacted':
          content.push(<ContextCompactedView block={block} key={key} />);
          break;
      }
    }
  } else if (message.content) {
    content.push(<TextBlockView key={`${message.id}:legacy-text`} messageId={message.id} block={{ type: 'text', content: message.content }} index={0} contentAdapters={contentAdapters} isStreaming={isStreaming} />);
  }

  for (const toolCall of message.toolCalls ?? []) {
    if (renderedToolIds.has(toolCall.id) || !shouldRenderToolCall(toolCall)) continue;
    content.push(projectionStore
      ? <ToolCallView key={`${message.id}:orphan:${toolCall.id}`} toolId={toolCall.id} projectionStore={projectionStore} contentAdapters={contentAdapters} />
      : <ToolCallView key={`${message.id}:orphan:${toolCall.id}`} toolCall={toolCall} contentAdapters={contentAdapters} />);
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
