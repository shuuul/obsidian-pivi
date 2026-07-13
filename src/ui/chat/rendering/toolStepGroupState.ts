import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';

import type { ToolContentRenderOptions } from './ToolCallRenderer';

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
  renderOptions: ToolContentRenderOptions;
  updateToolCall(toolId: string, toolCall: ToolCallInfo): void;
}

const states = new WeakMap<HTMLElement, ToolStepGroupState>();

export function registerToolStepGroupState(state: ToolStepGroupState): void {
  states.set(state.groupEl, state);
}

export function findToolStepGroupState(toolEl: HTMLElement): ToolStepGroupState | null {
  const groupEl = toolEl.closest<HTMLElement>(`.${TOOL_STEP_GROUP_CLASS}`);
  return groupEl ? states.get(groupEl) ?? null : null;
}
