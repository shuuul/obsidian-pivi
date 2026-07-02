import type { TodoItem } from '@pivi/tools';

import { renderTodoItems } from '../rendering/todoUtils';

export function renderTodoList(container: HTMLElement, items: TodoItem[]): void {
  container.addClass('pivi-todo-list-container');
  renderTodoItems(container, items);
}
