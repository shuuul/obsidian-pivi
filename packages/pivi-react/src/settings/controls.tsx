import { type ChangeEvent, type ClipboardEvent, type ReactNode, useState } from 'react';

import { PlatformIcon } from '../icons';

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
  return <select className="pivi-select pivi-settings-control" value={value} aria-label={label} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{children}</select>;
}

export function BadgeListInput({
  values,
  placeholder,
  inputLabel,
  removeLabel,
  disabled = false,
  onAdd,
  onRemove,
}: {
  readonly values: readonly string[];
  readonly placeholder?: string;
  readonly inputLabel: string;
  readonly removeLabel: (value: string) => string;
  readonly disabled?: boolean;
  readonly onAdd: (values: readonly string[]) => boolean | Promise<boolean>;
  readonly onRemove: (value: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [committing, setCommitting] = useState(false);
  const commit = async (inputs: readonly string[]) => {
    const entries = inputs.map(value => value.trim()).filter(Boolean);
    if (entries.length === 0 || committing || disabled) return;
    setCommitting(true);
    try {
      if (await onAdd(entries)) setDraft('');
    } finally {
      setCommitting(false);
    }
  };
  const remove = async (value: string) => {
    if (committing || disabled) return;
    setCommitting(true);
    try {
      await onRemove(value);
    } finally {
      setCommitting(false);
    }
  };
  const pasteLines = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/\r?\n/.test(text)) return;
    event.preventDefault();
    void commit([draft, ...text.split(/\r?\n/)]);
  };

  return (
    <div className="pivi-settings-badge-field">
      <div className="pivi-settings-badge-list">
        {values.map(value => (
          <span className="pivi-settings-badge" key={value}>
            <span className="pivi-settings-badge__text">{value}</span>
            <button
              type="button"
              className="pivi-settings-badge__remove"
              aria-label={removeLabel(value)}
              disabled={disabled || committing}
              onClick={() => { void remove(value); }}
            >
              <PlatformIcon name="x" />
            </button>
          </span>
        ))}
        <input
          className="pivi-settings-control pivi-settings-badge-input"
          aria-label={inputLabel}
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          disabled={disabled || committing}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => { void commit([draft]); }}
          onPaste={pasteLines}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void commit([draft]);
          }}
        />
      </div>
    </div>
  );
}
