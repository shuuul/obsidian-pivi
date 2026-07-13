import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isToolPresentationGroupable,
  shouldPresentToolCall,
} from '@pivi/pivi-agent-core/tools/toolPresentation';
import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';

import { setupCollapsible } from './collapsible';
import { renderStoredToolCall, updateToolCallElement } from './ToolCallRenderer';
import { getToolStepPhrase } from './toolPresentationI18n';
import { appendWorkingIcon } from './workingIcon';

export const TOOL_STEP_GROUP_CLASS = 'pivi-tool-step-group';
export const TOOL_STEP_GROUP_HEADER_CLASS = 'pivi-tool-step-group-header';

export interface ToolStepGroupState {
  groupEl: HTMLElement;
  headerEl: HTMLElement;
  countEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  stepsEl: HTMLElement;
  toolIds: string[];
  toolCallsById: Map<string, ToolCallInfo>;
  collapsibleState: { isExpanded: boolean };
}

const stepGroupStateByEl = new WeakMap<HTMLElement, ToolStepGroupState>();

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

function aggregateGroupStatus(toolCalls: ToolCallInfo[]): ToolCallInfo['status'] {
  if (toolCalls.some((tc) => tc.status === 'running')) return 'running';
  if (toolCalls.some((tc) => tc.status === 'error' || tc.status === 'blocked')) return 'error';
  return 'completed';
}

function buildGroupAriaLabel(toolCalls: ToolCallInfo[]): string {
  const count = toolCalls.length;
  const last = toolCalls[toolCalls.length - 1];
  const tail = last ? getToolStepPhrase(last.name, last.input, last.result) : '';
  return tail ? `${count} steps, latest: ${tail}` : `${count} steps`;
}

function getOrderedToolCalls(state: ToolStepGroupState): ToolCallInfo[] {
  return state.toolIds
    .map((id) => state.toolCallsById.get(id))
    .filter((tc): tc is ToolCallInfo => !!tc);
}

function syncGroupHeader(state: ToolStepGroupState, toolCalls: ToolCallInfo[]): void {
  const count = toolCalls.length;
  state.countEl.setText(t('chat.stream.steps', { count }));
  const last = toolCalls[toolCalls.length - 1];
  if (last) {
    state.summaryEl.setText(getToolStepPhrase(last.name, last.input, last.result));
    state.summaryEl.setAttribute('aria-hidden', 'true');
  }
  const status = aggregateGroupStatus(toolCalls);
  state.statusEl.empty();
  state.statusEl.removeAttribute('aria-hidden');
  state.statusEl.removeClass('status-running', 'status-completed', 'status-error', 'status-blocked');
  state.statusEl.addClass(`status-${status}`);
  state.statusEl.setAttribute('aria-label', t('chat.stream.statusLabel', { status }));
  if (status === 'running') {
    const workingIconEl = state.statusEl.createSpan({ cls: 'pivi-tool-step-group-working-icon' });
    appendWorkingIcon(workingIconEl);
  } else if (status === 'completed') {
    setIcon(state.statusEl, 'check');
  } else {
    setIcon(state.statusEl, 'x');
  }
  const expanded = state.collapsibleState.isExpanded;
  const action = expanded ? 'click to collapse' : 'click to expand';
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
  const toolEl = renderStoredToolCall(stepWrap, toolCall);
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
  const statusEl = headerEl.createSpan({ cls: 'pivi-tool-step-group-status pivi-tool-status' });

  const stepsEl = groupEl.createDiv({ cls: 'pivi-tool-step-group-steps pivi-hidden' });

  const collapsibleState = { isExpanded: false };
  let state: ToolStepGroupState | null = null;
  setupCollapsible(groupEl, headerEl, stepsEl, collapsibleState, {
    initiallyExpanded: false,
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
  };

  for (const toolCall of toolCalls) {
    mountStepRow(state, toolCall, toolCallElements);
  }
  syncGroupHeader(state, toolCalls);
  stepGroupStateByEl.set(groupEl, state);
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

export function recordToolCallInGroup(state: ToolStepGroupState, toolCall: ToolCallInfo): void {
  if (!state.toolIds.includes(toolCall.id)) return;
  state.toolCallsById.set(toolCall.id, toolCall);
  syncGroupHeader(state, getOrderedToolCalls(state));
}

/** Render visible stored calls as contiguous groups separated by standalone tools. */
export function renderStoredToolRuns(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
): void {
  let group: ToolCallInfo[] = [];
  const flush = () => {
    if (group.length === 0) return;
    createToolStepGroup(parentEl, group);
    group = [];
  };

  for (const toolCall of toolCalls) {
    if (!shouldPresentToolCall(toolCall.name, toolCall.input)) continue;
    if (isGroupable(toolCall)) {
      group.push(toolCall);
      continue;
    }
    flush();
    renderStoredToolCall(parentEl, toolCall);
  }
  flush();
}

export function tryUpdateToolInStepGroup(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
): boolean {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl?.classList.contains('pivi-tool-call-in-step-group')) {
    return false;
  }
  updateToolCallElement(toolEl, toolCall);

  const groupEl = toolEl.closest(`.${TOOL_STEP_GROUP_CLASS}`);
  if (!(groupEl instanceof HTMLElement)) return true;
  const state = stepGroupStateByEl.get(groupEl);
  if (!state) return true;

  state.toolCallsById.set(toolId, toolCall);
  syncGroupHeader(state, getOrderedToolCalls(state));
  return true;
}
