import type { DiffLine, DiffStats, ToolUseResult } from './diff';

/** Diff data for Write/Edit tool operations (pre-computed from SDK structuredPatch). */
export interface ToolDiffData {
  filePath: string;
  diffLines: DiffLine[];
  stats: DiffStats;
}

/** Parsed option for AskUserQuestion tool. */
export interface AskUserQuestionOption {
  label: string;
  description: string;
  value?: string;
}

/** Parsed question for AskUserQuestion tool. */
export interface AskUserQuestionItem {
  question: string;
  id?: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

/** User-provided answers keyed by question text or stable question id. */
export type AskUserAnswers = Record<string, string | string[]>;

/** Shared presentation vocabulary for tool and Agent activity. */
export type ActivityStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned';

/** Tool call tracking with status and result. */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'completed' | 'error' | 'blocked';
  /** Additive UI lifecycle fact when the legacy tool status is not specific enough. */
  activityStatus?: ActivityStatus;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  /** Structured tool result details persisted by Pi, used to fully restore rich tool UI. */
  toolUseResult?: ToolUseResult;
  isExpanded?: boolean;
  diffData?: ToolDiffData;
  resolvedAnswers?: AskUserAnswers;
  subagent?: SubagentInfo;
}

/** Subagent execution mode: sync (nested tools) or async (background). */
export type SubagentMode = 'sync' | 'async';

/** Async subagent lifecycle states. */
export type AsyncSubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'orphaned';

/** Subagent (Agent tool, legacy Task) tracking for sync and async modes. */
export interface SubagentInfo {
  id: string;
  /** UI nickname assigned by the host, typically unique within an open session. */
  writerName?: string;
  description: string;
  prompt?: string;
  mode?: SubagentMode;
  isExpanded: boolean;
  result?: string;
  status: 'running' | 'completed' | 'error';
  /** Additive UI lifecycle fact; persisted through the existing message_ui overlay. */
  activityStatus?: ActivityStatus;
  toolCalls: ToolCallInfo[];
  asyncStatus?: AsyncSubagentStatus;
  agentId?: string;
  outputToolId?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Map a legacy tool status without inventing waiting or cancellation. */
export function resolveToolActivityStatus(
  toolCall: Pick<ToolCallInfo, 'activityStatus' | 'status'>,
): ActivityStatus {
  if (toolCall.activityStatus) return toolCall.activityStatus;
  switch (toolCall.status) {
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'error':
    case 'blocked': return 'failed';
  }
}

/** Map stored sync/async Agent values while preferring explicit lifecycle facts. */
export function resolveSubagentActivityStatus(
  subagent: Pick<SubagentInfo, 'activityStatus' | 'asyncStatus' | 'status'>,
): ActivityStatus {
  switch (subagent.asyncStatus) {
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    case 'orphaned':
      return 'orphaned';
    case 'pending':
      if (subagent.activityStatus) return subagent.activityStatus;
      return 'queued';
    case 'running':
      if (subagent.activityStatus) return subagent.activityStatus;
      return 'running';
  }
  if (subagent.activityStatus) return subagent.activityStatus;
  switch (subagent.status) {
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'error': return 'failed';
  }
}
