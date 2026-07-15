import {
  type ActivityStatus,
  type AgentRun,
  type ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import { useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import {
  type ChatAgentRunEntity,
  type ChatProjectionStore,
  deriveAgentRunEntities,
  useChatProjectionAgentRuns,
} from '../../store';
import { ActivityRow } from './ActivityRow';

type PresentedRun = Pick<AgentRun,
  'completedAt' | 'currentActivity' | 'description' | 'runId' | 'startedAt' | 'status' | 'writerName'
>;

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

function AgentGroupPresentation({ runs }: { readonly runs: readonly PresentedRun[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
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
          {runs.map(run => (
            <div className="pivi-agent-run-row" data-agent-run-id={run.runId} key={run.runId}>
              <ActivityRow
                completedAt={run.completedAt}
                icon={<PlatformIcon name="bot" />}
                name={run.writerName ?? t('chat.activity.subagentTask')}
                startedAt={run.startedAt}
                status={run.status}
                summary={run.currentActivity?.toolName ?? run.description}
              />
            </div>
          ))}
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
