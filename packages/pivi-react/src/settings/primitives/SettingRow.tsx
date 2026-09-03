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
  readonly className?: string;
  readonly stacked?: boolean;
  readonly centered?: boolean;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly sortId?: string;
  readonly dragging?: boolean;
  readonly dragOffset?: number;
  readonly sortableHandleProps?: SortableReorderHandleProps<HTMLElement>;
}

export function SettingRow({
  name,
  description,
  className,
  stacked = false,
  centered = false,
  actions,
  children,
  sortId,
  dragging = false,
  dragOffset = 0,
  sortableHandleProps,
}: SettingRowProps) {
  const nameId = useId();
  const descriptionId = description ? `${nameId}-desc` : undefined;
  const context: SettingRowLabelContextValue = { nameId, descriptionId };
  const modifiers = [
    stacked ? ' pivi-settings-row--stacked' : '',
    centered ? ' pivi-settings-row--centered' : '',
    dragging ? ' is-dragging' : '',
  ].join('');
  const style: CSSProperties | undefined = dragging
    ? { transform: `translateY(${dragOffset}px)` }
    : undefined;
  return (
    <div
      className={`pivi-settings-row${modifiers}${className ? ` ${className}` : ''}`}
      data-settings-sort-id={sortId}
      style={style}
      onPointerDown={sortableHandleProps?.onPointerDown}
      onPointerMove={sortableHandleProps?.onPointerMove}
      onPointerUp={sortableHandleProps?.onPointerUp}
      onPointerCancel={sortableHandleProps?.onPointerCancel}
    >
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
