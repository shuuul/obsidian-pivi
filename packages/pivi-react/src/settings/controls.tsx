import {
  Children,
  type ClipboardEvent,
  cloneElement,
  createContext,
  type CSSProperties,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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
  readonly description?: ReactNode;
  readonly className?: string;
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

export function SettingRow({ name, description, className, children }: SettingRowProps) {
  const nameId = useId();
  const descriptionId = description ? `${nameId}-desc` : undefined;
  const context: SettingRowLabelContextValue = { nameId, descriptionId };
  return (
    <div className={`pivi-setting-row${className ? ` ${className}` : ''}`}>
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

interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled: boolean;
}

export function Select({ value, children, disabled = false, label, onChange }: { readonly value: string; readonly children: ReactNode; readonly disabled?: boolean; readonly label?: string; readonly onChange: (value: string) => void }) {
  const rowContext = useContext(SettingRowLabelContext);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const ariaLabel = label;
  const ariaLabelledBy = !label && rowContext
    ? buildSettingRowLabelledBy(rowContext.nameId, rowContext.descriptionId)
    : undefined;
  const options = useMemo(() => Children.toArray(children).flatMap<SelectOption>((child) => {
    if (!isValidElement(child) || child.type !== 'option') return [];
    const props = child.props as { readonly value?: string | number; readonly disabled?: boolean; readonly children?: ReactNode };
    return [{
      value: String(props.value ?? ''),
      label: props.children,
      disabled: Boolean(props.disabled),
    }];
  }), [children]);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = triggerRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const closeOutside = (event: Event): void => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || ownerDocument.getElementById(listboxId)?.contains(target)) return;
      setOpen(false);
    };
    const closeOnScroll = (): void => setOpen(false);
    ownerDocument.addEventListener('pointerdown', closeOutside);
    ownerDocument.addEventListener('scroll', closeOnScroll, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', closeOutside);
      ownerDocument.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [listboxId, open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const ownerWindow = triggerRef.current.ownerDocument.defaultView;
    const viewportHeight = ownerWindow?.innerHeight ?? 0;
    const roomBelow = viewportHeight - rect.bottom;
    const opensUpward = roomBelow < 180 && rect.top > roomBelow;
    setDropdownStyle({
      insetInlineEnd: Math.max(8, (ownerWindow?.innerWidth ?? rect.right) - rect.right),
      minWidth: rect.width,
      ...(opensUpward
        ? { insetBlockEnd: Math.max(8, viewportHeight - rect.top + 4) }
        : { insetBlockStart: rect.bottom + 4 }),
    });
  }, [open]);

  const openListbox = (): void => {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const choose = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    onChange(option.value);
    triggerRef.current?.focus();
  };
  const moveActive = (direction: 1 | -1): void => {
    if (options.length === 0) return;
    let next = activeIndex;
    do {
      next = (next + direction + options.length) % options.length;
    } while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openListbox();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (!open) return;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const direction = event.key === 'Home' ? 1 : -1;
      let next = event.key === 'Home' ? 0 : options.length - 1;
      while (options[next]?.disabled && next >= 0 && next < options.length) next += direction;
      if (next >= 0 && next < options.length) setActiveIndex(next);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  const dropdown = open ? (
    <div
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="pivi-settings-select__options"
      id={listboxId}
      role="listbox"
      style={dropdownStyle}
    >
      {options.map((option, index) => (
        <button
          aria-selected={option.value === value}
          className={`pivi-settings-select__option${option.value === value ? ' selected' : ''}${index === activeIndex ? ' is-highlighted' : ''}`}
          disabled={option.disabled}
          id={`${listboxId}-option-${index}`}
          key={option.value}
          onClick={() => choose(index)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          role="option"
          tabIndex={-1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`pivi-settings-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="pivi-select pivi-settings-control pivi-settings-select__trigger"
        disabled={disabled}
        onClick={() => open ? setOpen(false) : openListbox()}
        onKeyDown={onKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="pivi-settings-select__value">{selected?.label}</span>
        <span aria-hidden="true" className="pivi-settings-select__chevron">
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {dropdown && triggerRef.current ? createPortal(dropdown, triggerRef.current.ownerDocument.body) : null}
    </div>
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
