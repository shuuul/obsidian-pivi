/**
 * Todo tool helpers.
 *
 * Parses TodoWrite tool input into typed todo items.
 */

import { TOOL_TODO_WRITE } from './toolNames';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoVisualizationSource = 'tool' | 'session-history' | 'manual';

export interface TodoItem {
  id: string;
  /** Imperative description (e.g., "Run tests") */
  content: string;
  status: TodoStatus;
  /** Present continuous form (e.g., "Running tests") */
  activeForm?: string;
  sourceToolCallId?: string;
}

export interface TodoVisualizationProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export interface TodoVisualizationModel {
  items: TodoItem[];
  activeItemId?: string;
  progress: TodoVisualizationProgress;
  source: TodoVisualizationSource;
}

function isValidTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return (
    (record.id === undefined || typeof record.id === 'string') &&
    typeof record.content === 'string' &&
    record.content.length > 0 &&
    (record.activeForm === undefined || typeof record.activeForm === 'string') &&
    (record.sourceToolCallId === undefined || typeof record.sourceToolCallId === 'string') &&
    typeof record.status === 'string' &&
    isTodoStatus(record.status)
  );
}

function isTodoStatus(status: string): status is TodoStatus {
  return status === 'pending' || status === 'in_progress' || status === 'completed';
}

function createTodoId(item: TodoItem, index: number): string {
  return item.id || `todo-${index + 1}-${item.content.slice(0, 32).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}`;
}

function normalizeTodoItem(item: TodoItem, index: number, toolCallId?: string): TodoItem {
  return {
    id: createTodoId(item, index),
    content: item.content,
    status: item.status,
    ...(item.activeForm ? { activeForm: item.activeForm } : {}),
    ...(toolCallId || item.sourceToolCallId ? { sourceToolCallId: toolCallId ?? item.sourceToolCallId } : {}),
  };
}

export function parseTodoToolInput(input: unknown, toolCallId?: string): TodoItem[] | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (!record.todos || !Array.isArray(record.todos)) {
    return null;
  }

  const validTodos: TodoItem[] = [];
  for (const [index, item] of record.todos.entries()) {
    if (isValidTodoItem(item)) {
      validTodos.push(normalizeTodoItem(item, index, toolCallId));
    }
  }

  return validTodos.length > 0 ? validTodos : null;
}

export function parseTodoInput(input: Record<string, unknown>): TodoItem[] | null {
  return parseTodoToolInput(input);
}

export function deriveTodoVisualizationModel(
  todos: TodoItem[],
  source: TodoVisualizationSource
): TodoVisualizationModel {
  const items = todos.map((todo, index) => normalizeTodoItem(todo, index, todo.sourceToolCallId));
  const progress: TodoVisualizationProgress = {
    total: items.length,
    completed: items.filter(todo => todo.status === 'completed').length,
    inProgress: items.filter(todo => todo.status === 'in_progress').length,
    pending: items.filter(todo => todo.status === 'pending').length,
  };
  const activeItem = items.find(todo => todo.status === 'in_progress');

  return {
    items,
    ...(activeItem ? { activeItemId: activeItem.id } : {}),
    progress,
    source,
  };
}

/**
 * Extract the last TodoWrite todos from a list of messages.
 * Used to restore the todo panel when loading a saved session.
 */
export function extractLastTodosFromMessages(
  messages: Array<{ role: string; toolCalls?: Array<{ name: string; input: Record<string, unknown> }> }>
): TodoItem[] | null {
  return extractLastTodoVisualizationFromMessages(messages)?.items ?? null;
}

export function extractLastTodoVisualizationFromMessages(
  messages: Array<{ role: string; toolCalls?: Array<{ id?: string; name: string; input: Record<string, unknown> }> }>
): TodoVisualizationModel | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls[j];
        if (toolCall.name === TOOL_TODO_WRITE) {
          const todos = parseTodoToolInput(toolCall.input, toolCall.id);
          return todos ? deriveTodoVisualizationModel(todos, 'session-history') : null;
        }
      }
    }
  }
  return null;
}
