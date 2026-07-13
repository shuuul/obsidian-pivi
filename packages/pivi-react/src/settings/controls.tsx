import type { ChangeEvent, ReactNode } from 'react';

export interface SettingRowProps {
  readonly name: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function SettingHeading({ children }: { readonly children: ReactNode }) {
  return <div className="setting-item setting-item-heading"><div className="setting-item-info"><div className="setting-item-name">{children}</div></div></div>;
}

export function SettingRow({ name, description, children }: SettingRowProps) {
  return <div className="setting-item"><div className="setting-item-info"><div className="setting-item-name">{name}</div>{description ? <div className="setting-item-description">{description}</div> : null}</div><div className="setting-item-control">{children}</div></div>;
}

export function Toggle({ checked, disabled = false, onChange }: { readonly checked: boolean; readonly disabled?: boolean; readonly onChange: (checked: boolean) => void }) {
  return (
    <div
      className={`checkbox-container${checked ? ' is-enabled' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <input
        aria-label=""
        type="checkbox"
        checked={checked}
        disabled={disabled}
        readOnly
        tabIndex={-1}
      />
    </div>
  );
}

export function Select({ value, children, onChange }: { readonly value: string; readonly children: ReactNode; readonly onChange: (value: string) => void }) {
  return <select value={value} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{children}</select>;
}
