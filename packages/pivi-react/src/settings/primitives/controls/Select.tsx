import {
  Children,
  type CSSProperties,
  isValidElement,
  type KeyboardEvent,
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

import { PlatformIcon } from '../../../icons';
import { buildSettingRowLabelledBy, SettingRowLabelContext } from '../settingRowLabel';

interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled: boolean;
}

export function Select({
  value,
  children,
  disabled = false,
  label,
  onChange,
}: {
  readonly value: string;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onChange: (value: string) => void;
}) {
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
