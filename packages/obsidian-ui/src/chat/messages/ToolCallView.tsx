import type { SubagentMode, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { getToolIcon, MCP_ICON_MARKER } from '@pivi/pivi-agent-core/tools/toolIcons';
import {
  isWriteEditTool,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/I18nProvider';
import { McpIcon, ObsidianIcon } from '../../icons';
import {
  aggregateToolStatus,
  getToolDisplayName,
  getToolStepPhrase,
  getToolSummary,
} from './toolPresentation';
import type { MessageContentAdapter, MessageContentAdapters } from './types';

export interface ToolCallViewProps {
  readonly toolCall: ToolCallInfo;
  readonly contentAdapters?: MessageContentAdapters;
  readonly subagentMode?: SubagentMode;
  readonly compact?: boolean;
}

export interface ToolStepGroupViewProps {
  readonly toolCalls: readonly ToolCallInfo[];
  readonly contentAdapters?: MessageContentAdapters;
  readonly subagentMode?: SubagentMode;
}

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
  return <ObsidianIcon name={icon} />;
}

function ToolIcon({ name }: { readonly name: string }) {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) return <McpIcon />;
  return <ObsidianIcon name={icon} />;
}

function ImperativeToolSlot({ adapter, toolCall }: {
  readonly adapter: MessageContentAdapter<ToolCallInfo>;
  readonly toolCall: ToolCallInfo;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) return;
    return adapter.mount(container, toolCall, {
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
  useEffect(() => {
    const container = containerRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow) return;
    return adapter.mount(container, subagent, {
      generation: subagent.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
  }, [adapter, subagent]);
  return <div className="pivi-tool-content-adapter" ref={containerRef} />;
}

function resolveAdapter(toolCall: ToolCallInfo, contentAdapters?: MessageContentAdapters) {
  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    return toolCall.status !== 'completed' && toolCall.status !== 'error' && !toolCall.resolvedAnswers
      ? contentAdapters?.askUser ?? contentAdapters?.tool
      : undefined;
  }
  if (isWriteEditTool(toolCall.name)) return contentAdapters?.diff ?? contentAdapters?.tool;
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

function ToolContent({ toolCall, contentAdapters }: Pick<ToolCallViewProps, 'toolCall' | 'contentAdapters'>) {
  if (toolCall.subagent && contentAdapters?.subagent) {
    return <ImperativeSubagentSlot adapter={contentAdapters.subagent} subagent={toolCall.subagent} />;
  }
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

export function ToolCallView({ toolCall, contentAdapters, compact = false }: ToolCallViewProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const summary = getToolSummary(toolCall);
  const toolName = getToolDisplayName(toolCall, t);
  const statusLabel = t('chat.stream.statusLabel', { status: toolCall.status });
  const className = [
    'pivi-tool-call',
    toolCall.name === TOOL_BASH ? 'pivi-tool-call-bash' : '',
    toolCall.name === TOOL_WEB_SEARCH || toolCall.name === TOOL_WEB_FETCH ? 'pivi-tool-call-web' : '',
    compact ? 'pivi-tool-call-in-step-group pivi-tool-call-compact' : '',
    expanded ? 'expanded' : '',
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
        <span className={`pivi-tool-status status-${toolCall.status}`} aria-label={statusLabel}>
          {/* Individual rows keep check/x/blocked only; running spinner is group chrome. */}
          {toolCall.status === 'running' ? null : <StatusIcon status={toolCall.status} />}
        </span>
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <ObsidianIcon name="chevron-down" />
        </span>
      </button>
      {expanded && <div className="pivi-tool-content"><ToolContent toolCall={toolCall} contentAdapters={contentAdapters} /></div>}
    </div>
  );
}

export function ToolStepGroupView({ toolCalls, contentAdapters, subagentMode }: ToolStepGroupViewProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const status = aggregateToolStatus(toolCalls);
  const latest = toolCalls.at(-1);
  const latestPhrase = latest ? getToolStepPhrase(latest, t) : '';
  const countLabel = t('chat.stream.steps', { count: toolCalls.length });
  const ariaLabel = latestPhrase
    ? `${countLabel}, latest: ${latestPhrase}`
    : countLabel;

  return (
    <div className={`pivi-tool-step-group${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="pivi-tool-step-group-header"
        aria-expanded={expanded}
        aria-label={ariaLabel}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="pivi-tool-step-group-count">{countLabel}</span>
        <span className="pivi-tool-step-group-summary" aria-hidden="true">{latestPhrase}</span>
        <span className={`pivi-tool-step-group-status pivi-tool-status status-${status}`}>
          <StatusIcon status={status} />
        </span>
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <ObsidianIcon name="chevron-down" />
        </span>
      </button>
      {expanded && (
        <div className="pivi-tool-step-group-steps">
          {toolCalls.map(toolCall => (
            <div className="pivi-tool-step-item" key={toolCall.id}>
              <ToolCallView toolCall={toolCall} contentAdapters={contentAdapters} subagentMode={subagentMode} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
