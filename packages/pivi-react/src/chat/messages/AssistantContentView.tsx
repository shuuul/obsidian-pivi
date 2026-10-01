import type { ChatMessage, ContentBlock } from '@pivi/agent/runtime/chatTypes';
import type { SubagentInfo, ToolCallInfo } from '@pivi/agent/tools';
import { memo, type ReactElement, useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import {
  type ChatProjectionStore,
  getChatProjectionBlockId,
  useChatProjectionBlock,
} from '../../store';
import { formatTokensPerSecond } from '../../usage/usageInfo';
import { MemoryBoundary } from './MemoryBoundary';
import { ToolCallView, ToolStepGroupView } from './ToolCallView';
import { isGroupableToolCall, shouldRenderToolCall } from './toolPresentation';
import type { MessageContentAdapter, MessageContentAdapters } from './types';

export interface AssistantContentViewProps {
  readonly message: ChatMessage;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming?: boolean;
  readonly showTokensPerSecond?: boolean;
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
    adapter.update(container, value, {
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

interface AssistantVisibility {
  ordinaryTool: boolean;
  text: boolean;
  thinking: boolean;
  subagent: boolean;
  compactBoundary: boolean;
}

function noteVisibleToolCall(visibility: AssistantVisibility, toolCall: ToolCallInfo | undefined): void {
  if (!toolCall || !shouldRenderToolCall(toolCall)) return;
  if (toolCall.subagent) visibility.subagent = true;
  else visibility.ordinaryTool = true;
}

function noteVisibleBlock(visibility: AssistantVisibility, message: ChatMessage, block: ContentBlock): void {
  switch (block.type) {
    case 'text':
      if (block.content.trim().length > 0) visibility.text = true;
      break;
    case 'thinking':
      if (block.content.trim().length > 0) visibility.thinking = true;
      break;
    case 'context_compacted':
      visibility.compactBoundary = true;
      break;
    case 'subagent':
      visibility.subagent = true;
      break;
    case 'tool_use':
      noteVisibleToolCall(visibility, toolForBlock(message, block.toolId));
      break;
  }
}

/** Data-plane equivalent of pre-React updateAssistantToolOnlyClass. */
export function isAssistantToolOnlyMessage(message: ChatMessage, showTokensPerSecond = true): boolean {
  const visibility: AssistantVisibility = {
    ordinaryTool: false,
    text: Boolean(message.content?.trim()),
    thinking: false,
    subagent: false,
    compactBoundary: false,
  };
  for (const block of message.contentBlocks ?? []) {
    noteVisibleBlock(visibility, message, block);
  }
  for (const toolCall of message.toolCalls ?? []) {
    noteVisibleToolCall(visibility, toolCall);
  }

  const hasResponseFooter = Boolean(
    !visibility.compactBoundary
    && (
      (message.durationSeconds && message.durationSeconds > 0)
      // A hidden tokens/s footer must not suppress the tool-only class.
      || (showTokensPerSecond && message.tokensPerSecond !== undefined && message.tokensPerSecond > 0)
    ),
  );
  return visibility.ordinaryTool
    && !visibility.text
    && !visibility.thinking
    && !visibility.subagent
    && !hasResponseFooter
    && !visibility.compactBoundary;
}

interface BlockRenderContext {
  readonly message: ChatMessage;
  readonly contentAdapters?: MessageContentAdapters;
  readonly isStreaming: boolean;
  readonly projectionStore?: ChatProjectionStore;
  /** Tool calls already placed by a block, so the orphan pass does not repeat them. */
  readonly renderedToolIds: Set<string>;
}

function renderToolCall(context: BlockRenderContext, toolCall: ToolCallInfo, key: string): ReactElement {
  const { contentAdapters, projectionStore } = context;
  return projectionStore
    ? <ToolCallView key={key} toolId={toolCall.id} projectionStore={projectionStore} contentAdapters={contentAdapters} />
    : <ToolCallView key={key} toolCall={toolCall} contentAdapters={contentAdapters} />;
}

/** Collects the run of consecutive groupable tool blocks starting at `index`. */
function collectToolGroup(
  message: ChatMessage,
  blocks: readonly ContentBlock[],
  index: number,
  toolCall: ToolCallInfo,
): { grouped: ToolCallInfo[]; cursor: number } {
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
  return { grouped, cursor };
}

/** Renders the block at `index` and returns the index of the last block it consumed. */
function renderBlock(
  context: BlockRenderContext,
  blocks: readonly ContentBlock[],
  index: number,
  content: ReactElement[],
): number {
  const { message, contentAdapters, isStreaming, projectionStore, renderedToolIds } = context;
  const block = blocks[index];
  if (!block) return index;
  const key = `${message.id}:${index}:${block.type}`;
  const blockId = getChatProjectionBlockId(message.id, index);
  switch (block.type) {
    case 'text':
      content.push(projectionStore
        ? <SubscribedTextBlockView blockId={blockId} contentAdapters={contentAdapters} isStreaming={isStreaming} key={key} store={projectionStore} />
        : <TextBlockView key={key} messageId={message.id} block={block} index={index} contentAdapters={contentAdapters} isStreaming={isStreaming} />);
      return index;
    case 'thinking':
      content.push(projectionStore
        ? <SubscribedThinkingBlockView blockId={blockId} contentAdapters={contentAdapters} isStreaming={isStreaming} key={key} store={projectionStore} />
        : <ThinkingBlockView key={key} block={block} contentAdapters={contentAdapters} generation={`${message.id}:thinking:${index}`} isStreaming={isStreaming} />);
      return index;
    case 'tool_use': {
      const toolCall = toolForBlock(message, block.toolId);
      if (!toolCall || !shouldRenderToolCall(toolCall)) return index;
      const { grouped, cursor } = collectToolGroup(message, blocks, index, toolCall);
      grouped.forEach(item => renderedToolIds.add(item.id));
      if (grouped.length > 1) {
        content.push(projectionStore
          ? <ToolStepGroupView contentAdapters={contentAdapters} key={key} projectionStore={projectionStore} toolIds={grouped.map(item => item.id)} />
          : <ToolStepGroupView contentAdapters={contentAdapters} key={key} toolCalls={grouped} />);
        return cursor - 1;
      }
      content.push(renderToolCall(context, toolCall, key));
      return index;
    }
    case 'subagent': {
      const resolved = subagentForBlock(message, block.subagentId);
      if (!resolved) return index;
      renderedToolIds.add(resolved.toolCall.id);
      content.push(renderToolCall(context, resolved.toolCall, key));
      return index;
    }
    case 'context_compacted':
      content.push(<ContextCompactedView block={block} key={key} />);
      return index;
    default:
      return index;
  }
}

function renderResponseFooter(
  message: ChatMessage,
  showTokensPerSecond: boolean,
  t: ReturnType<typeof useT>,
): ReactElement | null {
  const durationLabel = message.durationSeconds && message.durationSeconds > 0
    ? t('chat.stream.responseDuration', {
        flavor: message.durationFlavorWord ?? t('chat.stream.defaultDurationFlavor'),
        duration: formatDuration(message.durationSeconds),
      })
    : null;
  const speedLabel = showTokensPerSecond && message.tokensPerSecond !== undefined && message.tokensPerSecond > 0
    ? t('chat.stream.tokensPerSecond', { rate: formatTokensPerSecond(message.tokensPerSecond) })
    : null;
  if (!durationLabel && !speedLabel) return null;
  return (
    <div className="pivi-response-footer" key={`${message.id}:duration`}>
      <span className="pivi-baked-duration pivi-response-meta">
        {durationLabel && speedLabel ? `${durationLabel} · ${speedLabel}` : durationLabel ?? speedLabel}
      </span>
    </div>
  );
}

/** Ordered assistant block presentation. contentBlocks are authoritative; toolCalls are resolved by id only. */
export function AssistantContentView({ message, contentAdapters, isStreaming = false, projectionStore, showTokensPerSecond = true }: AssistantContentViewProps) {
  const t = useT();
  const blocks = message.contentBlocks;
  const context: BlockRenderContext = {
    message,
    contentAdapters,
    isStreaming,
    projectionStore,
    renderedToolIds: new Set<string>(),
  };
  const content: ReactElement[] = [];

  if (blocks?.length) {
    for (let index = 0; index < blocks.length; index++) {
      index = renderBlock(context, blocks, index, content);
    }
  } else if (message.content) {
    content.push(<TextBlockView key={`${message.id}:legacy-text`} messageId={message.id} block={{ type: 'text', content: message.content }} index={0} contentAdapters={contentAdapters} isStreaming={isStreaming} />);
  }

  for (const toolCall of message.toolCalls ?? []) {
    if (context.renderedToolIds.has(toolCall.id) || !shouldRenderToolCall(toolCall)) continue;
    content.push(renderToolCall(context, toolCall, `${message.id}:orphan:${toolCall.id}`));
  }

  const hasCompactBoundary = blocks?.some(block => block.type === 'context_compacted') ?? false;
  const footer = hasCompactBoundary ? null : renderResponseFooter(message, showTokensPerSecond, t);
  if (footer) {
    content.push(footer);
  }

  return <>{content}</>;
}
