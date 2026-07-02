import type { TodoVisualizationModel } from '@pivi/tools';

import { renderTodoList } from './TodoList';
import { renderTodoProgress } from './TodoProgress';

export function renderTodoVisualizationPanel(container: HTMLElement, model: TodoVisualizationModel): void {
  container.empty();
  container.addClass('pivi-todo-panel');
  container.setAttribute('data-pivi-todo-source', model.source);

  const progressEl = container.createDiv({ cls: 'pivi-todo-panel-progress' });
  renderTodoProgress(progressEl, model.progress);

  const listEl = container.createDiv({ cls: 'pivi-todo-panel-list' });
  renderTodoList(listEl, model.items);
}
