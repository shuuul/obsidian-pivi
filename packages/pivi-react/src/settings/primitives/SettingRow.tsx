import { Children, type CSSProperties, type ReactNode, useId } from 'react';

import type { SortableReorderHandleProps } from '../../reorder/useSortableReorder';
import {
  augmentSettingRowControl,
  SettingRowLabelContext,
  type SettingRowLabelContextValue,
} from './settingRowLabel';

export interface SettingRowProps {
  readonly name?: string;
  readonly description?: ReactNode;
  readonly leading?: ReactNode;
  readonly indented?: boolean;
  readonly className?: string;
  readonly stacked?: boolean;
  readonly centered?: boolean;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly sortId?: string;
  readonly dragging?: boolean;
  readonly dragOffset?: number;
  readonly sortableHandleProps?: SortableReorderHandleProps<HTMLElement>;
  readonly dropIndicatorEdge?: 'before' | 'after';
  readonly reorderLabel?: string;
}

export function SettingRow({
  name,
  description,
  leading,
  indented = false,
  className,
  stacked = false,
  centered = false,
  actions,
  children,
  sortId,
  dragging = false,
  dragOffset = 0,
  sortableHandleProps,
  dropIndicatorEdge,
  reorderLabel,
}: SettingRowProps) {
  const nameId = useId();
  const descriptionId = description ? `${nameId}-desc` : undefined;
  const context: SettingRowLabelContextValue = { nameId, descriptionId };
  const modifiers = [
    stacked ? ' pivi-settings-row--stacked' : '',
    centered ? ' pivi-settings-row--centered' : '',
    indented ? ' pivi-settings-row--indented' : '',
    dragging ? ' is-dragging' : '',
    dropIndicatorEdge ? ` is-drop-${dropIndicatorEdge}` : '',
  ].join('');
  const style: CSSProperties | undefined = dragging
    ? { transform: `translateY(${dragOffset}px)` }
    : undefined;
  return (
    <div
      className={`pivi-settings-row${modifiers}${className ? ` ${className}` : ''}`}
      data-settings-sort-id={sortId}
      style={style}
    >
      {sortableHandleProps ? (
        <button
          type="button"
          className="pivi-settings-row__handle pivi-settings-action-btn"
          aria-label={reorderLabel}
          aria-pressed={dragging}
          {...sortableHandleProps}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      ) : null}
      {leading ? <div className="pivi-settings-row__leading">{leading}</div> : null}
      {name || description ? (
        <div className="pivi-settings-row__info">
          {name ? <div className="pivi-settings-row__name" id={nameId}>{name}</div> : null}
          {description ? <div className="pivi-setting-description" id={descriptionId}>{description}</div> : null}
        </div>
      ) : null}
      {children != null ? (
        <div className="pivi-settings-row__control">
          <SettingRowLabelContext.Provider value={context}>
            {Children.map(children, child => augmentSettingRowControl(child, context))}
          </SettingRowLabelContext.Provider>
        </div>
      ) : null}
      {actions ? <div className="pivi-settings-row__actions">{actions}</div> : null}
    </div>
  );
}
