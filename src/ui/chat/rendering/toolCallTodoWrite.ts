import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { TodoItem } from '@pivi/pivi-agent-core/tools/todo';
import { TOOL_APPLY_PATCH } from '@pivi/pivi-agent-core/tools/toolNames';
import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';

import { renderDiffStats } from './DiffRenderer';
import { renderTodoItems } from './todoUtils';
import { getApplyPatchDiffStats, getDiffStatsAriaLabel } from './toolCallApplyPatchExpanded';


export function getTodos(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

export function getCurrentTask(input: Record<string, unknown>): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

export function areAllTodosCompleted(input: Record<string, unknown>): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

export function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'pivi-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

export function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown>): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = isComplete
    ? t('chat.stream.statusLabel', { status: 'completed' })
    : t('chat.stream.statusLabel', { status: 'in progress' });
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

export function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, t('chat.stream.statusLabel', { status }));
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

export function setApplyPatchHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';
  const stats = isError ? undefined : getApplyPatchDiffStats(toolCall.input);
  if (!stats) {
    setToolStatus(statusEl, toolCall.status);
    return;
  }

  statusEl.className = 'pivi-tool-status pivi-write-edit-stats';
  statusEl.empty();
  statusEl.setAttribute('aria-label', getDiffStatsAriaLabel(stats));
  renderDiffStats(statusEl, stats);
}

export function setGenericToolHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    setApplyPatchHeaderRight(statusEl, toolCall);
    return;
  }

  setToolStatus(statusEl, toolCall.status);
}

export function renderTodoWriteResult(
  container: HTMLElement,
  input: Record<string, unknown>
): void {
  container.empty();
  container.addClass('pivi-todo-panel-content');
  container.addClass('pivi-todo-list-container');

  const todos = input.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = container.createSpan({ cls: 'pivi-tool-result-item' });
    item.setText(t('chat.stream.tasksUpdated'));
    return;
  }

  renderTodoItems(container, todos);
}
export function createCurrentTaskPreview(
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = header.createSpan({ cls: 'pivi-tool-current' });
  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.setText(currentTask.activeForm ?? currentTask.content);
  }
  return currentTaskEl;
}

export function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.toggleClass('pivi-hidden', expanded);
    }
    if (statusEl) {
      statusEl.toggleClass('pivi-hidden', expanded);
    }
  };
}
