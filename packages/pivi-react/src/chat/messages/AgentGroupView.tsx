import {
  type ActivityStatus,
  resolveSubagentActivityStatus,
  resolveToolActivityStatus,
  type ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import { type CSSProperties, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import {
  type ChatAgentRunEntity,
  type ChatProjectionStore,
  deriveAgentRunEntities,
  useChatProjectionAgentRuns,
} from '../../store';
import { ActivityRow } from './ActivityRow';
import { getToolDisplayName, getToolSummary, shouldRenderToolCall } from './toolPresentation';

type PresentedRun = ChatAgentRunEntity;

interface AgentTimelineStep {
  readonly depth: number;
  readonly id: string;
  readonly name: string;
  readonly status: ActivityStatus;
  readonly summary?: string;
  readonly type: 'agent' | 'tool';
}

export type AgentGroupViewProps = {
  readonly messageId: string;
} & (
  | {
      readonly projectionStore: ChatProjectionStore;
      readonly runIds: readonly string[];
      readonly toolCalls?: never;
    }
  | {
      readonly projectionStore?: never;
      readonly runIds?: never;
      readonly toolCalls: readonly ToolCallInfo[];
    }
);

function statusLabel(status: ActivityStatus, t: ReturnType<typeof useT>): string {
  switch (status) {
    case 'queued': return t('chat.status.queued');
    case 'running': return t('chat.status.running');
    case 'waiting': return t('chat.status.waiting');
    case 'completed': return t('chat.status.completed');
    case 'failed': return t('chat.status.failed');
    case 'cancelled': return t('chat.status.cancelled');
    case 'orphaned': return t('chat.status.orphaned');
  }
}

function aggregateStatus(runs: readonly PresentedRun[]): ActivityStatus {
  const statuses = runs.map(run => run.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('waiting')) return 'waiting';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('cancelled')) return 'cancelled';
  if (statuses.includes('orphaned')) return 'orphaned';
  return 'completed';
}

function deriveTimelineSteps(
  toolCalls: readonly ToolCallInfo[],
  t: ReturnType<typeof useT>,
  depth = 0,
): AgentTimelineStep[] {
  return toolCalls.flatMap((toolCall) => {
    if (!shouldRenderToolCall(toolCall)) return [];
    const subagent = toolCall.subagent;
    const step: AgentTimelineStep = subagent ? {
      depth,
      id: toolCall.id,
      name: subagent.writerName ?? t('chat.activity.subagentTask'),
      status: resolveSubagentActivityStatus(subagent),
      summary: subagent.description,
      type: 'agent',
    } : {
      depth,
      id: toolCall.id,
      name: getToolDisplayName(toolCall, t),
      status: resolveToolActivityStatus(toolCall),
      summary: getToolSummary(toolCall).summary,
      type: 'tool',
    };
    return [
      step,
      ...(subagent ? deriveTimelineSteps(subagent.toolCalls, t, depth + 1) : []),
    ];
  });
}

function AgentRunRow({ run }: { readonly run: PresentedRun }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const name = run.writerName ?? t('chat.activity.subagentTask');
  const summary = run.currentActivity?.toolName ?? run.description;
  const timelineLabel = t('chat.activity.agentRunTimeline', { agent: name });
  const steps = deriveTimelineSteps(run.agent.toolCalls, t);

  return (
    <div className={`pivi-agent-run-row${expanded ? ' expanded' : ''}`} data-agent-run-id={run.runId}>
      <button
        aria-expanded={expanded}
        aria-label={`${name}: ${summary}`}
        className="pivi-agent-run-header"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <ActivityRow
          completedAt={run.completedAt}
          icon={<PlatformIcon name="bot" />}
          name={name}
          startedAt={run.startedAt}
          status={run.status}
          summary={summary}
        />
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {expanded ? (
        <div aria-label={timelineLabel} className="pivi-agent-run-inspector" role="region">
          <dl className="pivi-agent-run-brief">
            <div>
              <dt>{t('chat.activity.objective')}</dt>
              <dd>{run.description}</dd>
            </div>
            {run.prompt ? (
              <div>
                <dt>{t('chat.activity.prompt')}</dt>
                <dd>{run.prompt}</dd>
              </div>
            ) : null}
          </dl>
          {steps.length > 0 ? (
            <ol aria-label={t('chat.activity.timeline')} className="pivi-agent-run-timeline">
              {steps.map(step => (
                <li
                  className={`pivi-agent-run-step pivi-agent-run-step--${step.type}`}
                  data-depth={step.depth}
                  key={step.id}
                  style={{ '--pivi-agent-run-depth': step.depth } as CSSProperties}
                >
                  <ActivityRow
                    icon={<PlatformIcon name={step.type === 'agent' ? 'bot' : 'wrench'} />}
                    name={step.name}
                    status={step.status}
                    summary={step.summary}
                  />
                </li>
              ))}
            </ol>
          ) : null}
          {!run.report && run.terminalResult?.text ? (
            <div className="pivi-agent-run-result">
              <span className="pivi-agent-run-result-label">{t('chat.activity.result')}</span>
              <p>{run.terminalResult.text}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentConclusion({ run }: { readonly run: PresentedRun }) {
  const t = useT();
  const report = run.report;
  if (!report || run.status === 'queued' || run.status === 'running' || run.status === 'waiting') {
    return null;
  }
  const name = run.writerName ?? t('chat.activity.subagentTask');
  const lists = [
    [t('chat.activity.findings'), report.findings],
    [t('chat.activity.decisions'), report.decisions],
    [t('chat.activity.openQuestions'), report.openQuestions],
  ] as const;

  return (
    <section aria-label={t('chat.activity.agentConclusion', { agent: name })} className="pivi-agent-conclusion">
      <header>
        <h4>{t('chat.activity.agentConclusion', { agent: name })}</h4>
        <span>{statusLabel(report.outcome, t)}</span>
      </header>
      <p>{report.summary ?? report.objective}</p>
      {lists.map(([label, values]) => values && values.length > 0 ? (
        <div className="pivi-agent-conclusion-list" key={label}>
          <h5>{label}</h5>
          <ul>{values.map(value => <li key={value}>{value}</li>)}</ul>
        </div>
      ) : null)}
      {report.artifacts && report.artifacts.length > 0 ? (
        <div className="pivi-agent-conclusion-list">
          <h5>{t('chat.activity.artifacts')}</h5>
          <ul>{report.artifacts.map(artifact => (
            <li key={`${artifact.label}:${artifact.vaultPath ?? ''}`}>
              {artifact.label}{artifact.vaultPath ? ` — ${artifact.vaultPath}` : ''}
            </li>
          ))}</ul>
        </div>
      ) : null}
    </section>
  );
}

function AgentGroupPresentation({ runs }: { readonly runs: readonly PresentedRun[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const conclusionRuns = runs.filter(run => run.report
    && run.status !== 'queued'
    && run.status !== 'running'
    && run.status !== 'waiting');
  const counts = new Map<ActivityStatus, number>();
  for (const run of runs) counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  const summary = [...counts.entries()]
    .map(([status, count]) => t('chat.activity.agentGroupStatusCount', {
      count,
      status: statusLabel(status, t),
    }))
    .join(' · ');
  const label = t('chat.activity.agentGroupCount', { count: runs.length });

  return (
    <div className={`pivi-agent-group${expanded ? ' expanded' : ''}`}>
      <button
        aria-expanded={expanded}
        aria-label={`${label}: ${summary}`}
        className="pivi-agent-group-header"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <ActivityRow
          icon={<PlatformIcon name="users" />}
          name={label}
          status={aggregateStatus(runs)}
          summary={summary}
        />
        <span aria-hidden="true" className={`pivi-collapsible-chevron${expanded ? '' : ' is-collapsed'}`}>
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {expanded ? (
        <div className="pivi-agent-group-runs">
          {runs.map(run => <AgentRunRow key={run.runId} run={run} />)}
        </div>
      ) : null}
      {conclusionRuns.length > 0 ? (
        <div className="pivi-agent-group-conclusions">
          {conclusionRuns.map(run => <AgentConclusion key={run.runId} run={run} />)}
        </div>
      ) : null}
    </div>
  );
}

function ProjectedAgentGroup({ projectionStore, runIds }: {
  readonly projectionStore: ChatProjectionStore;
  readonly runIds: readonly string[];
}) {
  const entities = useChatProjectionAgentRuns(projectionStore, runIds)
    .filter((entity): entity is ChatAgentRunEntity => entity !== null);
  return <AgentGroupPresentation runs={entities} />;
}

export function AgentGroupView(props: AgentGroupViewProps) {
  if (props.projectionStore) {
    return <ProjectedAgentGroup projectionStore={props.projectionStore} runIds={props.runIds} />;
  }
  const runs = props.toolCalls.flatMap(tool => deriveAgentRunEntities(tool, props.messageId, null));
  const topLevelRuns = runs.filter(run => run.parentRunId === null);
  return <AgentGroupPresentation runs={topLevelRuns} />;
}
