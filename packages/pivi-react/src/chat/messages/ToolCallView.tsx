import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isWriteEditTool,
  TOOL_ASK_USER_QUESTION,
} from '@pivi/pivi-agent-core/tools/toolNames';
import {
  getToolIcon,
  getToolPresentationDescriptor,
  MCP_ICON_MARKER,
} from '@pivi/pivi-agent-core/tools/toolPresentation';
import { memo, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/I18nProvider';
import { McpIcon, PlatformIcon } from '../../icons';
import {
  type ChatProjectionStore,
  useChatProjectionTool,
  useChatProjectionTools,
} from '../../store';
import {
  aggregateToolStatus,
  getToolDisplayName,
  getToolSummary,
} from './toolPresentation';
import type { MessageContentAdapter, MessageContentAdapters } from './types';

interface ToolCallViewCommonProps {
  readonly contentAdapters?: MessageContentAdapters;
  readonly compact?: boolean;
}

export type ToolCallViewProps = ToolCallViewCommonProps & (
  | {
      readonly toolCall: ToolCallInfo;
      readonly projectionStore?: never;
      readonly toolId?: never;
    }
  | {
      readonly projectionStore: ChatProjectionStore;
      readonly toolCall?: never;
      readonly toolId: string;
    }
);

export type ToolStepGroupViewProps = {
  readonly contentAdapters?: MessageContentAdapters;
} & (
  | {
      readonly toolCalls: readonly ToolCallInfo[];
      readonly projectionStore?: never;
      readonly toolIds?: never;
    }
  | {
      readonly projectionStore: ChatProjectionStore;
      readonly toolCalls?: never;
      readonly toolIds: readonly string[];
    }
);

function StatusIcon({ status }: { readonly status: ToolCallInfo['status'] }) {
  if (status === 'running') {
    return (
      <span className="pivi-working-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle className="pivi-working-icon-track" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path className="pivi-working-icon-arc" d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  const icon = status === 'completed'
    ? 'check'
    : status === 'error'
      ? 'x'
      : status === 'blocked'
        ? 'shield-off'
        : null;
  if (!icon) return null;
  return <PlatformIcon name={icon} />;
}

function ToolIcon({ name }: { readonly name: string }) {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) return <McpIcon />;
  return <PlatformIcon name={icon} />;
}

function ImperativeToolSlot({ adapter, toolCall }: {
  readonly adapter: MessageContentAdapter<ToolCallInfo>;
  readonly toolCall: ToolCallInfo;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedValueRef = useRef<ToolCallInfo | null>(null);
  const latestValueRef = useRef(toolCall);
  latestValueRef.current = toolCall;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const initialValue = latestValueRef.current;
    mountedValueRef.current = initialValue;
    const dispose = adapter.mount(container, initialValue, {
      generation: initialValue.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
    return () => {
      mountedValueRef.current = null;
      dispose?.();
    };
  }, [adapter, toolCall.id]);

  useEffect(() => {
    const container = containerRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow || mountedValueRef.current === toolCall) return;
    mountedValueRef.current = toolCall;
    adapter.update?.(container, toolCall, {
      generation: toolCall.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
  }, [adapter, toolCall]);

  return <div ref={containerRef} className="pivi-tool-content-adapter" />;
}

function ImperativeSubagentSlot({
  adapter,
  subagent,
}: {
  readonly adapter: MessageContentAdapter<NonNullable<ToolCallInfo['subagent']>>;
  readonly subagent: NonNullable<ToolCallInfo['subagent']>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedValueRef = useRef<typeof subagent | null>(null);
  const latestValueRef = useRef(subagent);
  latestValueRef.current = subagent;
  useEffect(() => {
    const container = containerRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow) return;
    const initialValue = latestValueRef.current;
    mountedValueRef.current = initialValue;
    const dispose = adapter.mount(container, initialValue, {
      generation: initialValue.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
    return () => {
      mountedValueRef.current = null;
      dispose?.();
    };
  }, [adapter, subagent.id]);

  useEffect(() => {
    const container = containerRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow || mountedValueRef.current === subagent) return;
    mountedValueRef.current = subagent;
    adapter.update?.(container, subagent, {
      generation: subagent.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
  }, [adapter, subagent]);
  return <div className="pivi-subagent-content-adapter" ref={containerRef} />;
}

function resolveAdapter(toolCall: ToolCallInfo, contentAdapters?: MessageContentAdapters) {
  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    return toolCall.status !== 'completed' && toolCall.status !== 'error' && !toolCall.resolvedAnswers
      ? contentAdapters?.askUser ?? contentAdapters?.tool
      : undefined;
  }
  return contentAdapters?.tool;
}

function GenericToolContent({ toolCall }: { readonly toolCall: ToolCallInfo }) {
  const t = useT();
  if (toolCall.status === 'running' && !toolCall.result) {
    return <div className="pivi-tool-result-row"><span className="pivi-tool-result-text">{t('chat.stream.writing')}</span></div>;
  }
  if (!toolCall.result) return null;
  return (
    <div className="pivi-tool-lines">
      {toolCall.result.split('\n').map((line, index) => (
        <div className="pivi-tool-line" key={`${index}:${line}`}>{line}</div>
      ))}
    </div>
  );
}

function ToolContent({ toolCall, contentAdapters }: {
  readonly toolCall: ToolCallInfo;
  readonly contentAdapters?: MessageContentAdapters;
}) {
  if (
    toolCall.name === TOOL_ASK_USER_QUESTION
    && (toolCall.status === 'completed' || toolCall.status === 'error')
  ) {
    return <GenericToolContent toolCall={toolCall} />;
  }
  const reactContent = contentAdapters?.renderToolContent?.(toolCall);
  if (reactContent !== undefined && reactContent !== null) return <>{reactContent}</>;
  const adapter = resolveAdapter(toolCall, contentAdapters);
  if (adapter) return <ImperativeToolSlot adapter={adapter} toolCall={toolCall} />;
  return <GenericToolContent toolCall={toolCall} />;
}

function ToolCallPresentation({ toolCall, contentAdapters, compact = false }: {
  readonly toolCall: ToolCallInfo;
  readonly contentAdapters?: MessageContentAdapters;
  readonly compact?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (toolCall.subagent && contentAdapters?.subagent) {
    return <ImperativeSubagentSlot adapter={contentAdapters.subagent} subagent={toolCall.subagent} />;
  }
  const descriptor = getToolPresentationDescriptor(toolCall.name);
  const summary = getToolSummary(toolCall);
  const toolName = getToolDisplayName(toolCall, t);
  const statusLabel = t('chat.stream.statusLabel', { status: toolCall.status });
  const className = [
    'pivi-tool-call',
    descriptor.className ? `pivi-tool-call-${descriptor.className}` : '',
    compact ? 'pivi-tool-call-in-step-group pivi-tool-call-compact' : '',
    expanded ? 'expanded' : '',
    toolCall.status === 'running' ? 'is-running' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} data-tool-id={toolCall.id}>
      <button
        type="button"
        className="pivi-tool-header"
        aria-expanded={expanded}
        aria-label={summary.summary ? `${toolName}: ${summary.summary}` : toolName}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="pivi-tool-icon" aria-hidden="true"><ToolIcon name={toolCall.name} /></span>
        <span className="pivi-tool-name">{toolName}</span>
        <span className="pivi-tool-summary">{summary.summary}</span>
        {isWriteEditTool(toolCall.name)
        && toolCall.diffData
        && (toolCall.diffData.stats.added > 0 || toolCall.diffData.stats.removed > 0) ? (
          <span className="pivi-write-edit-stats">
            {toolCall.diffData.stats.added > 0
              ? <span className="added">+{toolCall.diffData.stats.added}</span>
              : null}
            {toolCall.diffData.stats.removed > 0
              ? <span className="removed">-{toolCall.diffData.stats.removed}</span>
              : null}
          </span>
        ) : null}
        <span className={`pivi-tool-status status-${toolCall.status}`} aria-label={statusLabel}>
          {/* Individual rows keep check/x/blocked only; running spinner is group chrome. */}
          {toolCall.status === 'running' ? null : <StatusIcon status={toolCall.status} />}
        </span>
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {expanded && <div className="pivi-tool-content"><ToolContent toolCall={toolCall} contentAdapters={contentAdapters} /></div>}
    </div>
  );
}

function ProjectedToolCallView({
  compact,
  contentAdapters,
  projectionStore,
  toolId,
}: Extract<ToolCallViewProps, { projectionStore: ChatProjectionStore }>) {
  const entity = useChatProjectionTool(projectionStore, toolId);
  if (!entity) return null;
  return (
    <ToolCallPresentation
      compact={compact}
      contentAdapters={contentAdapters}
      toolCall={entity.tool as ToolCallInfo}
    />
  );
}

export const ToolCallView = memo(function ToolCallView(props: ToolCallViewProps) {
  if (props.projectionStore) return <ProjectedToolCallView {...props} />;
  return <ToolCallPresentation {...props} />;
});

function ToolStepGroupPresentation({ toolCalls, contentAdapters, projectionStore }: {
  readonly toolCalls: readonly ToolCallInfo[];
  readonly contentAdapters?: MessageContentAdapters;
  readonly projectionStore?: ChatProjectionStore;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const status = aggregateToolStatus(toolCalls);
  const toolNames = [...new Set(toolCalls.map(toolCall => getToolDisplayName(toolCall, t)))];
  const toolNamesLabel = toolNames.join(', ');
  const countLabel = t('chat.stream.steps', { count: toolCalls.length });
  const ariaLabel = toolNamesLabel
    ? `${countLabel}, ${toolNamesLabel}`
    : countLabel;

  return (
    <div className={`pivi-tool-step-group${expanded ? ' expanded' : ''}${status === 'running' ? ' is-running' : ''}`}>
      <button
        type="button"
        className="pivi-tool-step-group-header"
        aria-expanded={expanded}
        aria-label={ariaLabel}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="pivi-tool-step-group-count">{countLabel}</span>
        <span className="pivi-tool-step-group-summary" aria-hidden="true">{toolNamesLabel}</span>
        <span className={`pivi-tool-step-group-status pivi-tool-status status-${status}`}>
          <StatusIcon status={status} />
        </span>
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {expanded && (
        <div className="pivi-tool-step-group-steps">
          {toolCalls.map(toolCall => (
            <div className="pivi-tool-step-item" key={toolCall.id}>
              {projectionStore
                ? <ToolCallView contentAdapters={contentAdapters} projectionStore={projectionStore} toolId={toolCall.id} compact />
                : <ToolCallPresentation toolCall={toolCall} contentAdapters={contentAdapters} compact />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectedToolStepGroupView({
  contentAdapters,
  projectionStore,
  toolIds,
}: Extract<ToolStepGroupViewProps, { projectionStore: ChatProjectionStore }>) {
  const entities = useChatProjectionTools(projectionStore, toolIds);
  const toolCalls = entities.flatMap(entity => entity ? [entity.tool as ToolCallInfo] : []);
  if (toolCalls.length === 0) return null;
  return (
    <ToolStepGroupPresentation
      contentAdapters={contentAdapters}
      projectionStore={projectionStore}
      toolCalls={toolCalls}
    />
  );
}

function equalToolGroupProps(
  previous: Readonly<ToolStepGroupViewProps>,
  next: Readonly<ToolStepGroupViewProps>,
): boolean {
  if (previous.contentAdapters !== next.contentAdapters) return false;
  if (previous.projectionStore || next.projectionStore) {
    if (!previous.projectionStore || !next.projectionStore) return false;
    if (previous.projectionStore !== next.projectionStore) return false;
    return previous.toolIds.length === next.toolIds.length
      && previous.toolIds.every((toolId, index) => toolId === next.toolIds[index]);
  }
  return previous.toolCalls === next.toolCalls;
}

export const ToolStepGroupView = memo(function ToolStepGroupView(props: ToolStepGroupViewProps) {
  if (props.projectionStore) return <ProjectedToolStepGroupView {...props} />;
  return <ToolStepGroupPresentation {...props} />;
}, equalToolGroupProps);
