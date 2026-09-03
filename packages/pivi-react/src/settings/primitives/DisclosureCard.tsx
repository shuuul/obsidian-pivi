import { type CSSProperties, type ReactNode, useContext, useId } from 'react';

import { PlatformIcon } from '../../icons';
import type { SortableReorderHandleProps } from '../../reorder/useSortableReorder';
import { SettingsInlineActions } from './SettingsInlineActions';
import { SettingsNestingContext } from './SettingsSection';

export function DisclosureCard({
  name,
  summary,
  icon,
  badges,
  actions,
  open,
  onToggle,
  children,
  className,
  sortId,
  sortableHandleProps,
  consumeClickAfterDrag,
  dragging = false,
  dragOffset = 0,
  reorderLabel,
}: {
  readonly name: string;
  readonly summary?: ReactNode;
  readonly icon?: ReactNode;
  readonly badges?: ReactNode;
  readonly actions?: ReactNode;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly sortId?: string;
  readonly sortableHandleProps?: SortableReorderHandleProps<HTMLElement>;
  readonly consumeClickAfterDrag?: () => boolean;
  readonly dragging?: boolean;
  readonly dragOffset?: number;
  readonly reorderLabel?: string;
}) {
  const bodyId = useId();
  const nesting = useContext(SettingsNestingContext);
  const style: CSSProperties | undefined = dragging
    ? { transform: `translateY(${dragOffset}px)` }
    : undefined;

  return (
    <div
      className={`pivi-settings-card${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      data-settings-sort-id={sortId}
      style={style}
    >
      <div
        className="pivi-settings-card__header"
        onPointerDown={sortableHandleProps?.onPointerDown}
        onPointerMove={sortableHandleProps?.onPointerMove}
        onPointerUp={sortableHandleProps?.onPointerUp}
        onPointerCancel={sortableHandleProps?.onPointerCancel}
      >
        <button
          type="button"
          className="pivi-settings-card__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          data-sortable-surface=""
          onClick={() => {
            if (consumeClickAfterDrag?.()) return;
            onToggle();
          }}
        >
          {icon ? <span className="pivi-settings-card__icon">{icon}</span> : null}
          <div className="pivi-settings-card__identity">
            <span className="pivi-settings-card__name">{name}</span>
            {summary ? <span className="pivi-settings-card__summary">{summary}</span> : null}
          </div>
          {badges ? <span className="pivi-settings-card__badges">{badges}</span> : null}
        </button>
        {actions || sortableHandleProps ? (
          <SettingsInlineActions>
            {actions}
            {sortableHandleProps ? (
              <button
                type="button"
                className="pivi-settings-card__handle pivi-settings-action-btn"
                aria-label={reorderLabel}
                aria-pressed={dragging}
                onKeyDown={sortableHandleProps.onKeyDown}
              >
                <span aria-hidden="true">⠿</span>
              </button>
            ) : null}
          </SettingsInlineActions>
        ) : null}
        <button
          type="button"
          className="pivi-settings-card__chevron"
          aria-hidden="true"
          tabIndex={-1}
          data-sortable-surface=""
          onClick={() => {
            if (consumeClickAfterDrag?.()) return;
            onToggle();
          }}
        >
          <PlatformIcon name="chevron-down" />
        </button>
      </div>
      {open ? (
        <SettingsNestingContext.Provider value={nesting + 1}>
          <div id={bodyId} className="pivi-settings-card__body">
            {children}
          </div>
        </SettingsNestingContext.Provider>
      ) : null}
    </div>
  );
}
