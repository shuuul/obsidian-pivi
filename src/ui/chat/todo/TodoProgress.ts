import type { TodoVisualizationProgress } from '@pivi/tools';

export function renderTodoProgress(container: HTMLElement, progress: TodoVisualizationProgress): void {
  container.empty();
  container.addClass('pivi-todo-progress');

  const summary = container.createSpan({
    cls: 'pivi-todo-progress-summary',
    text: `Tasks ${progress.completed}/${progress.total}`,
  });
  summary.setAttribute('aria-label', `${progress.completed} of ${progress.total} tasks completed`);

  const meter = container.createDiv({ cls: 'pivi-todo-progress-meter' });
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(progress.total));
  meter.setAttribute('aria-valuenow', String(progress.completed));

  const fill = meter.createDiv({ cls: 'pivi-todo-progress-fill' });
  fill.style.width = progress.total > 0 ? `${Math.round((progress.completed / progress.total) * 100)}%` : '0%';
}
