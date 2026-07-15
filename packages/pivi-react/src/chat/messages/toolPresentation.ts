import {
  type ActivityStatus,
  resolveToolActivityStatus,
  type ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import {
  getToolStepPhraseModel,
  isToolPresentationGroupable,
  type ResolvedToolPresentation,
  resolveToolPresentation,
  shouldPresentToolCall,
  type ToolPresentationTitle,
} from '@pivi/pivi-agent-core/tools/toolPresentation';

import type { TFunction } from '../../i18n/types';

export type ToolPresentationStatus = ActivityStatus;
export type ToolSummary = Pick<ResolvedToolPresentation, 'summary' | 'todoProgress'>;

export type ToolCallRun =
  | { readonly kind: 'single'; readonly toolCall: ToolCallInfo }
  | { readonly kind: 'group'; readonly toolCalls: readonly ToolCallInfo[] };

function translateTitle(title: ToolPresentationTitle, t: TFunction): string {
  if (!title.key) return title.fallback;
  return title.params ? t(title.key, title.params) : t(title.key);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

/** Visible tool header title. Translation stays in the React presentation package. */
export function getToolDisplayName(toolCall: ToolCallInfo, t: TFunction): string {
  return translateTitle(resolveToolPresentation(
    toolCall.name,
    toolCall.input,
    toolCall.result,
  ).title, t);
}

export function getToolSummary(toolCall: ToolCallInfo): ToolSummary {
  const { summary, todoProgress } = resolveToolPresentation(
    toolCall.name,
    toolCall.input,
    toolCall.result,
  );
  return { summary, todoProgress };
}

/** Short verb phrase for group header / aria (does not replace display name). */
export function getToolStepPhrase(toolCall: ToolCallInfo, t: TFunction): string {
  const model = getToolStepPhraseModel(toolCall.name, toolCall.input, toolCall.result);
  const base = translateTitle(model.base, t);
  return model.summary ? truncate(`${base}: ${model.summary}`, 72) : base;
}

export function aggregateToolStatus(toolCalls: readonly ToolCallInfo[]): ToolPresentationStatus {
  const statuses = toolCalls.map(resolveToolActivityStatus);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('waiting')) return 'waiting';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('cancelled')) return 'cancelled';
  if (statuses.includes('orphaned')) return 'orphaned';
  return 'completed';
}

/** Provider lifecycle output and empty write_stdin calls do not create rows. */
export function shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
  return shouldPresentToolCall(toolCall.name, toolCall.input);
}

/** Ask-user, todos, subagents, and hidden tools stay outside aggregate groups. */
export function isGroupableToolCall(toolCall: ToolCallInfo): boolean {
  return isToolPresentationGroupable(toolCall.name, toolCall.input, !!toolCall.subagent);
}

export function groupToolCallRuns(toolCalls: readonly ToolCallInfo[]): readonly ToolCallRun[] {
  const runs: ToolCallRun[] = [];
  let group: ToolCallInfo[] = [];

  const flush = () => {
    if (group.length === 0) return;
    runs.push({ kind: 'group', toolCalls: group });
    group = [];
  };

  for (const toolCall of toolCalls) {
    if (!shouldRenderToolCall(toolCall)) continue;
    if (isGroupableToolCall(toolCall)) {
      group.push(toolCall);
      continue;
    }
    flush();
    runs.push({ kind: 'single', toolCall });
  }
  flush();
  return runs;
}
