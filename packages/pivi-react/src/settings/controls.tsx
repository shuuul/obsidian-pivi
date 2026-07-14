import type { ChangeEvent, ReactNode } from 'react';

export interface SettingRowProps {
  readonly name: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function SettingsPageDescription({ children }: { readonly children: ReactNode }) {
  return <div className="pivi-settings-page-description">{children}</div>;
}

export function SettingsListHeader({
  title,
  actions,
}: {
  readonly title?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="pivi-settings-list-header">
      {title ? <h2 className="pivi-settings-list-header__title">{title}</h2> : null}
      {actions ? <div className="pivi-settings-list-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SettingHeading({ children }: { readonly children: ReactNode }) {
  return <div className="pivi-setting-row pivi-setting-row--heading"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{children}</div></div></div>;
}

export function SettingRow({ name, description, children }: SettingRowProps) {
  return <div className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{name}</div>{description ? <div className="pivi-setting-description">{description}</div> : null}</div><div className="pivi-setting-row__control">{children}</div></div>;
}

export function Toggle({ checked, disabled = false, label, onChange }: { readonly checked: boolean; readonly disabled?: boolean; readonly label: string; readonly onChange: (checked: boolean) => void }) {
  return (
    <label
      className={`pivi-toggle${checked ? ' pivi-toggle--enabled' : ''}${disabled ? ' pivi-toggle--disabled' : ''}`}
    >
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" className="pivi-toggle-thumb" />
    </label>
  );
}

export function Select({ value, children, label, onChange }: { readonly value: string; readonly children: ReactNode; readonly label?: string; readonly onChange: (value: string) => void }) {
  return <select className="pivi-select" value={value} aria-label={label} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{children}</select>;
}
