import { useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatUiSnapshot } from '../../store';

export function TodoSurface({ model }: {
  model: ChatUiSnapshot['currentTodoVisualizationModel'];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  if (!model || model.items.length === 0) return null;
  const active = model.items.find(item => item.id === model.activeItemId);
  const progressParams = {
    completed: model.progress.completed,
    total: model.progress.total,
  };
  return (
    <div className="pivi-status-panel pivi-status-panel-todos">
      <button
        aria-expanded={expanded}
        aria-label={t(expanded ? 'chat.todos.collapse' : 'chat.todos.expand', progressParams)}
        className="pivi-status-panel-header"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <span className="pivi-status-panel-icon"><PlatformIcon name="list-todo" /></span>
        <span className="pivi-status-panel-label">{t('chat.todos.progress', progressParams)}</span>
        {!expanded && active ? <span className="pivi-status-panel-current">{active.activeForm ?? active.content}</span> : null}
        {!expanded && model.progress.completed === model.progress.total ? <span className="pivi-status-panel-status status-completed"><PlatformIcon name="check" /></span> : null}
      </button>
      {expanded ? (
        <div className="pivi-status-panel-content pivi-todo-panel" data-pivi-todo-source={model.source}>
          <div className="pivi-todo-panel-progress">
            <div className="pivi-todo-progress-summary">{t('chat.todos.progress', progressParams)}</div>
            <div className="pivi-todo-progress-meter"><div className="pivi-todo-progress-fill" style={{ width: `${model.progress.total ? (model.progress.completed / model.progress.total) * 100 : 0}%` }} /></div>
          </div>
          <div className="pivi-todo-panel-list pivi-todo-list-container">
            {model.items.map(item => (
              <div className={`pivi-todo-item pivi-todo-${item.status}`} key={item.id}>
                <span aria-hidden="true" className="pivi-todo-status-icon"><PlatformIcon name={item.status === 'completed' ? 'check' : 'dot'} /></span>
                <span className="pivi-todo-text">{item.status === 'in_progress' ? (item.activeForm ?? item.content) : item.content}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
