import { type ClipboardEvent, useState } from 'react';

import { PlatformIcon } from '../../../icons';
import type { SettingsFeedbackMessage } from '../../../ports';
import { SettingsFeedback } from '../SettingsFeedback';

export function BadgeListInput({
  values,
  placeholder,
  inputLabel,
  removeLabel,
  disabled = false,
  feedback,
  onAdd,
  onRemove,
}: {
  readonly values: readonly string[];
  readonly placeholder?: string;
  readonly inputLabel: string;
  readonly removeLabel: (value: string) => string;
  readonly disabled?: boolean;
  readonly feedback?: SettingsFeedbackMessage | null;
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
      <SettingsFeedback feedback={feedback} />
    </div>
  );
}
