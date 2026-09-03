import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';

const COMMON_COMMAND_ICONS = [
  'message-square',
  'languages',
  'sparkles',
  'list-collapse',
  'file-text',
  'book-open',
  'search',
  'pencil',
  'wand-sparkles',
  'brain',
  'lightbulb',
  'globe',
] as const;

const COMMAND_ICON_PAGE_SIZE = 150;

export function CommandIconPicker({
  disabled,
  icon,
  iconNames,
  onChange,
  compact = false,
}: {
  readonly disabled: boolean;
  readonly icon: string;
  readonly iconNames: readonly string[];
  readonly onChange: (icon: string) => void;
  readonly compact?: boolean;
}) {
  const t = useT();
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(COMMAND_ICON_PAGE_SIZE);
  const filteredIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      return iconNames
        .filter(name => name.toLowerCase().includes(normalizedQuery));
    }

    const availableIcons = new Set(iconNames);
    return [...new Set([icon, ...COMMON_COMMAND_ICONS, ...iconNames])]
      .filter(name => availableIcons.has(name));
  }, [icon, iconNames, query]);
  const visibleIcons = filteredIcons.slice(0, visibleLimit);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery('');
    setVisibleLimit(COMMAND_ICON_PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (!open) return;
    const picker = pickerRef.current;
    const ownerDocument = picker?.ownerDocument;
    if (!picker || !ownerDocument) return;
    const OwnerNode = ownerDocument.defaultView?.Node;
    const handlePointerDown = (event: Event) => {
      if (OwnerNode && event.target instanceof OwnerNode && !picker.contains(event.target)) {
        closePicker();
      }
    };
    ownerDocument.addEventListener('pointerdown', handlePointerDown);
    return () => { ownerDocument.removeEventListener('pointerdown', handlePointerDown); };
  }, [closePicker, open]);

  const selectIcon = (name: string) => {
    onChange(name);
    closePicker();
  };

  return <div className={`pivi-command-icon-picker${compact ? ' pivi-command-icon-picker--compact' : ''}`} ref={pickerRef}>
    <button
      type="button"
      className="pivi-command-icon-trigger"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t('settings.createCommand.icon.choose')}
      disabled={disabled}
      onClick={() => {
        if (open) closePicker();
        else setOpen(true);
      }}
    >
      <PlatformIcon name={icon} />
      {compact ? null : <span>{icon}</span>}
    </button>
    {open
      ? <div className="pivi-command-icon-popover" role="dialog" aria-label={t('settings.createCommand.icon.pickerTitle')} onKeyDown={(event) => {
        if (event.key === 'Escape') closePicker();
      }}>
        <input
          autoFocus
          className="pivi-settings-control pivi-settings-control--fill"
          type="search"
          value={query}
          aria-label={t('settings.createCommand.icon.search')}
          placeholder={t('settings.createCommand.icon.searchPlaceholder')}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleLimit(COMMAND_ICON_PAGE_SIZE);
          }}
        />
        {visibleIcons.length > 0
          ? <div
            className="pivi-command-icon-grid"
            role="listbox"
            aria-label={t('settings.createCommand.icon.results')}
            onScroll={(event) => {
              const grid = event.currentTarget;
              if (
                grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 48
                && visibleLimit < filteredIcons.length
              ) {
                setVisibleLimit(limit => Math.min(
                  limit + COMMAND_ICON_PAGE_SIZE,
                  filteredIcons.length,
                ));
              }
            }}
          >
            {visibleIcons.map(name => <button
              key={name}
              type="button"
              role="option"
              aria-label={name}
              aria-selected={name === icon}
              className={name === icon ? 'is-selected' : undefined}
              title={name}
              onClick={() => selectIcon(name)}
            >
              <PlatformIcon name={name} />
              <span>{name}</span>
            </button>)}
          </div>
          : <div className="pivi-command-icon-empty">{t('settings.createCommand.icon.noResults')}</div>}
      </div>
      : null}
  </div>;
}
