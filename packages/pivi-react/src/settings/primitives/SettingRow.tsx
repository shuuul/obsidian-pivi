import { Children, type ReactNode, useId } from 'react';

import {
  augmentSettingRowControl,
  SettingRowLabelContext,
  type SettingRowLabelContextValue,
} from './settingRowLabel';

export interface SettingRowProps {
  readonly name: string;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly stacked?: boolean;
  readonly centered?: boolean;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}

export function SettingRow({
  name,
  description,
  className,
  stacked = false,
  centered = false,
  actions,
  children,
}: SettingRowProps) {
  const nameId = useId();
  const descriptionId = description ? `${nameId}-desc` : undefined;
  const context: SettingRowLabelContextValue = { nameId, descriptionId };
  const modifiers = [
    stacked ? ' pivi-settings-row--stacked' : '',
    centered ? ' pivi-settings-row--centered' : '',
  ].join('');
  return (
    <div className={`pivi-settings-row${modifiers}${className ? ` ${className}` : ''}`}>
      <div className="pivi-settings-row__info">
        <div className="pivi-settings-row__name" id={nameId}>{name}</div>
        {description ? <div className="pivi-setting-description" id={descriptionId}>{description}</div> : null}
      </div>
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
