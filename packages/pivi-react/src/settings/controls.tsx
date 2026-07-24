import {
  type ChangeEvent,
  Children,
  type ClipboardEvent,
  cloneElement,
  createContext,
  isValidElement,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useId,
  useState,
} from 'react';

import { PlatformIcon } from '../icons';
import type { SettingsFeedbackMessage } from '../ports';

interface SettingRowLabelContextValue {
  readonly nameId: string;
  readonly descriptionId?: string;
}

const SettingRowLabelContext = createContext<SettingRowLabelContextValue | null>(null);

function buildSettingRowLabelledBy(
  nameId: string,
  descriptionId?: string,
  existing?: string,
): string {
  return [nameId, descriptionId, existing].filter(Boolean).join(' ');
}

function augmentSettingRowControl(
  node: ReactNode,
  context: SettingRowLabelContextValue,
): ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as {
    readonly 'aria-label'?: string;
    readonly 'aria-labelledby'?: string;
    readonly children?: ReactNode;
    readonly label?: string;
  };
  if (props['aria-label'] || props.label) return node;

  const elementType = node.type;
  if (typeof elementType === 'string' && ['input', 'textarea', 'select'].includes(elementType)) {
    return cloneElement(node as ReactElement<Record<string, unknown>>, {
      'aria-labelledby': buildSettingRowLabelledBy(
        context.nameId,
        context.descriptionId,
        props['aria-labelledby'],
      ),
    });
  }

  if (props.children) {
    return cloneElement(
      node,
      {},
      Children.map(props.children, child => augmentSettingRowControl(child, context)),
    );
  }
  return node;
}

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
      {title ? <SettingsSectionHeading>{title}</SettingsSectionHeading> : null}
      {actions ? <div className="pivi-settings-list-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SettingsSectionHeading({
  children,
  id,
  level = 2,
}: {
  readonly children: ReactNode;
  readonly id?: string;
  readonly level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const levelClass = level === 3 ? ' pivi-settings-section-heading--sub' : '';
  return (
    <Heading id={id} className={`pivi-settings-section-heading${levelClass}`}>
      {children}
    </Heading>
  );
}

export function SettingsSection({
  title,
  headingId,
  headingLevel = 2,
  children,
}: {
  readonly title: ReactNode;
  readonly headingId?: string;
  readonly headingLevel?: 2 | 3;
  readonly children: ReactNode;
}) {
  return (
    <section
      className="pivi-settings-section"
      {...(headingId ? { 'aria-labelledby': headingId } : {})}
    >
      <SettingsSectionHeading id={headingId} level={headingLevel}>
        {title}
      </SettingsSectionHeading>
      <div className="pivi-settings-section__body">{children}</div>
    </section>
  );
}

export function SettingRow({ name, description, children }: SettingRowProps) {
  const nameId = useId();
  const descriptionId = description ? `${nameId}-desc` : undefined;
  const context: SettingRowLabelContextValue = { nameId, descriptionId };
  return (
    <div className="pivi-setting-row">
      <div className="pivi-setting-row__info">
        <div className="pivi-setting-row__name" id={nameId}>{name}</div>
        {description ? <div className="pivi-setting-description" id={descriptionId}>{description}</div> : null}
      </div>
      <div className="pivi-setting-row__control">
        <SettingRowLabelContext.Provider value={context}>
          {Children.map(children, child => augmentSettingRowControl(child, context))}
        </SettingRowLabelContext.Provider>
      </div>
    </div>
  );
}

export function SettingsActionFeedback({ feedback }: { readonly feedback?: SettingsFeedbackMessage | null }) {
  if (!feedback) return null;
  return (
    <span
      className={`pivi-settings-action-feedback is-${feedback.kind}`}
      role={feedback.kind === 'error' ? 'alert' : 'status'}
    >
      {feedback.message}
    </span>
  );
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

export function SettingsItemActions({
  children,
  className = '',
  isolate = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly isolate?: boolean;
}) {
  return (
    <span
      className={`pivi-settings-item-actions${className ? ` ${className}` : ''}`}
      {...(isolate ? {
        'data-toolbar-control': true,
        onClick: (event: MouseEvent<HTMLSpanElement>) => { event.stopPropagation(); },
        onPointerDown: (event: PointerEvent<HTMLSpanElement>) => { event.stopPropagation(); },
      } : {})}
    >
      {children}
    </span>
  );
}

export function SettingsRemoveButton({
  ariaLabel,
  disabled = false,
  className = '',
  onClick,
}: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`pivi-settings-action-btn pivi-settings-delete-btn${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <PlatformIcon name="trash-2" />
    </button>
  );
}

export function Select({ value, children, disabled = false, label, onChange }: { readonly value: string; readonly children: ReactNode; readonly disabled?: boolean; readonly label?: string; readonly onChange: (value: string) => void }) {
  const rowContext = useContext(SettingRowLabelContext);
  const ariaLabel = label;
  const ariaLabelledBy = !label && rowContext
    ? buildSettingRowLabelledBy(rowContext.nameId, rowContext.descriptionId)
    : undefined;
  return (
    <select
      className="pivi-select pivi-settings-control"
      value={value}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

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
      <SettingsActionFeedback feedback={feedback} />
    </div>
  );
}
