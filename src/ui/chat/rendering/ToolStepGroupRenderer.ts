import {
  resolveToolActivityStatus,
  type ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import {
  isToolPresentationGroupable,
  shouldPresentToolCall,
} from '@pivi/pivi-agent-core/tools/toolPresentation';

import { t } from '@/app/i18n';

import { renderActivityStatusCountSummary } from './activityStatusPresentation';
import { setupCollapsible } from './collapsible';
import {
  renderStoredToolCall,
  type ToolContentRenderOptions,
} from './ToolCallRenderer';
import { getToolName } from './toolPresentationI18n';
import {
  registerToolStepGroupState,
  TOOL_STEP_GROUP_CLASS,
  TOOL_STEP_GROUP_HEADER_CLASS,
  type ToolStepGroupState,
} from './toolStepGroupState';

export {
  TOOL_STEP_GROUP_CLASS,
  TOOL_STEP_GROUP_HEADER_CLASS,
  type ToolStepGroupState,
} from './toolStepGroupState';

function isGroupable(toolCall: ToolCallInfo): boolean {
  return isToolPresentationGroupable(
    toolCall.name,
    toolCall.input,
    !!toolCall.subagent,
  );
}

function requireGroupable(toolCall: ToolCallInfo): void {
  if (!isGroupable(toolCall)) {
    throw new Error(`Tool ${toolCall.name} cannot be mounted in an imperative step group.`);
  }
}

function getUniqueToolNames(toolCalls: ToolCallInfo[]): string[] {
  return [...new Set(toolCalls.map(toolCall => (
    getToolName(toolCall.name, toolCall.input, toolCall.result)
  )))];
}

function buildGroupAriaLabel(toolCalls: ToolCallInfo[]): string {
  const countLabel = t('chat.stream.steps', { count: toolCalls.length });
  const names = getUniqueToolNames(toolCalls).join(', ');
  return names ? `${countLabel}, ${names}` : countLabel;
}

function getOrderedToolCalls(state: ToolStepGroupState): ToolCallInfo[] {
  return state.toolIds
    .map((id) => state.toolCallsById.get(id))
    .filter((tc): tc is ToolCallInfo => !!tc);
}

function syncGroupHeader(state: ToolStepGroupState, toolCalls: ToolCallInfo[]): void {
  const count = toolCalls.length;
  state.countEl.setText(t('chat.stream.steps', { count }));
  state.summaryEl.setText(getUniqueToolNames(toolCalls).join(', '));
  state.summaryEl.setAttribute('aria-hidden', 'true');
  renderActivityStatusCountSummary(
    state.statusEl,
    toolCalls.map(resolveToolActivityStatus),
  );
  const expanded = state.collapsibleState.isExpanded;
  const action = expanded ? t('chat.activity.collapse') : t('chat.activity.expand');
  state.headerEl.setAttribute('aria-label', `${buildGroupAriaLabel(toolCalls)} - ${action}`);
}

function mountStepRow(
  state: ToolStepGroupState,
  toolCall: ToolCallInfo,
  toolCallElements?: Map<string, HTMLElement>,
): HTMLElement {
  requireGroupable(toolCall);
  const stepWrap = state.stepsEl.createDiv({ cls: 'pivi-tool-step-item' });
  stepWrap.dataset.toolId = toolCall.id;
  const toolEl = renderStoredToolCall(stepWrap, toolCall, state.renderOptions);
  toolEl.addClass('pivi-tool-call-in-step-group');
  toolEl.addClass('pivi-tool-call-compact');
  state.toolIds.push(toolCall.id);
  state.toolCallsById.set(toolCall.id, toolCall);
  toolCallElements?.set(toolCall.id, toolEl);
  return toolEl;
}

export function createToolStepGroup(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
  toolCallElements?: Map<string, HTMLElement>,
  renderOptions: ToolContentRenderOptions = {},
): ToolStepGroupState {
  if (toolCalls.length === 0) {
    throw new Error('An imperative tool step group requires at least one tool call.');
  }
  toolCalls.forEach(requireGroupable);

  const groupEl = parentEl.createDiv({ cls: TOOL_STEP_GROUP_CLASS });
  groupEl.addClass('pivi-collapsible');

  const headerEl = groupEl.createDiv({ cls: TOOL_STEP_GROUP_HEADER_CLASS });

  const countEl = headerEl.createSpan({ cls: 'pivi-tool-step-group-count' });
  const summaryEl = headerEl.createSpan({ cls: 'pivi-tool-step-group-summary' });
  const statusEl = headerEl.createSpan({ cls: 'pivi-tool-step-group-status' });

  const stepsEl = groupEl.createDiv({ cls: 'pivi-tool-step-group-steps pivi-hidden' });

  const collapsibleState = { isExpanded: false };
  let state: ToolStepGroupState | null = null;
  setupCollapsible(groupEl, headerEl, stepsEl, collapsibleState, {
    initiallyExpanded: false,
    onBeforeToggle: () => renderOptions.beginDisclosureResize?.(headerEl),
    onToggle: () => {
      if (state) syncGroupHeader(state, getOrderedToolCalls(state));
    },
  });

  state = {
    groupEl,
    headerEl,
    countEl,
    summaryEl,
    statusEl,
    stepsEl,
    toolIds: [],
    toolCallsById: new Map(),
    collapsibleState,
    renderOptions,
    updateToolCall(toolId, toolCall) {
      if (!state?.toolIds.includes(toolId)) return;
      state.toolCallsById.set(toolId, toolCall);
      syncGroupHeader(state, getOrderedToolCalls(state));
    },
  };

  for (const toolCall of toolCalls) {
    mountStepRow(state, toolCall, toolCallElements);
  }
  syncGroupHeader(state, toolCalls);
  registerToolStepGroupState(state);
  return state;
}

export function appendStepToStreamingGroup(
  state: ToolStepGroupState,
  toolCall: ToolCallInfo,
  toolCallElements?: Map<string, HTMLElement>,
): void {
  if (state.toolIds.includes(toolCall.id)) return;
  requireGroupable(toolCall);
  mountStepRow(state, toolCall, toolCallElements);
  syncGroupHeader(state, getOrderedToolCalls(state));
}

/** Render visible stored calls as contiguous groups separated by standalone tools. */
export function renderStoredToolRuns(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
  renderOptions: ToolContentRenderOptions = {},
): void {
  let group: ToolCallInfo[] = [];
  const flush = () => {
    if (group.length === 0) return;
    createToolStepGroup(parentEl, group, undefined, renderOptions);
    group = [];
  };

  for (const toolCall of toolCalls) {
    if (!shouldPresentToolCall(toolCall.name, toolCall.input)) continue;
    if (isGroupable(toolCall)) {
      group.push(toolCall);
      continue;
    }
    flush();
    renderStoredToolCall(parentEl, toolCall, renderOptions);
  }
  flush();
}
