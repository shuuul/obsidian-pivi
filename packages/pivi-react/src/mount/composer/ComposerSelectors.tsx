import {
  type CSSProperties,
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatUiSnapshot, ComposerOptionSnapshot, DeepReadonly } from '../../store';
import type { ComposerChromeActions } from '../activeChatUiBridge';
import { ModelOptionIcon } from '../ModelOptionIcon';

function getFixedDropdownStyle(trigger: HTMLElement, estimatedWidth: number): CSSProperties {
  const ownerWindow = trigger.ownerDocument.defaultView;
  if (!ownerWindow) return {};
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const opensAbove = rect.top > ownerWindow.innerHeight - rect.bottom;
  const maxHeight = Math.max(80, (opensAbove ? rect.top : ownerWindow.innerHeight - rect.bottom) - margin - gap);
  const left = Math.max(margin, Math.min(rect.left, ownerWindow.innerWidth - estimatedWidth - margin));
  return opensAbove
    ? { bottom: ownerWindow.innerHeight - rect.top + gap, left, maxHeight, maxWidth: ownerWindow.innerWidth - margin * 2 }
    : { left, maxHeight, maxWidth: ownerWindow.innerWidth - margin * 2, top: rect.bottom + gap };
}

function containsEventTarget(container: HTMLElement | null, target: EventTarget | null): boolean {
  return Boolean(container && target && 'nodeType' in target && container.contains(target as Node));
}

function getThinkingOptionTitle(option: DeepReadonly<ComposerOptionSnapshot>): string | undefined {
  if (option.tokens === undefined) return option.description;
  if (option.tokens > 0) return `${option.tokens.toLocaleString()} tokens`;
  return 'Disabled';
}

type SelectorOpenMode = 'closed' | 'hover' | 'pinned';

function useSelectorDisclosure() {
  const [mode, setMode] = useState<SelectorOpenMode>('closed');
  const modeRef = useRef<SelectorOpenMode>('closed');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closeTimerWindowRef = useRef<Window | null>(null);
  const suppressRevealRef = useRef(false);
  const setModeNow = useCallback((next: SelectorOpenMode): void => {
    modeRef.current = next;
    setMode(next);
  }, []);
  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current !== null) closeTimerWindowRef.current?.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    closeTimerWindowRef.current = null;
  }, []);
  const close = useCallback((): void => {
    cancelClose();
    setModeNow('closed');
  }, [cancelClose, setModeNow]);
  const reveal = useCallback((): void => {
    if (suppressRevealRef.current) return;
    cancelClose();
    if (modeRef.current === 'closed') setModeNow('hover');
  }, [cancelClose, setModeNow]);
  const focusTrigger = useCallback((): void => {
    suppressRevealRef.current = true;
    triggerRef.current?.focus();
    suppressRevealRef.current = false;
  }, []);
  const togglePinned = useCallback((): void => {
    cancelClose();
    setModeNow(modeRef.current === 'pinned' ? 'closed' : 'pinned');
  }, [cancelClose, setModeNow]);
  const scheduleHoverClose = useCallback((relatedTarget: EventTarget | null): void => {
    if (
      modeRef.current !== 'hover'
      || containsEventTarget(triggerRef.current, relatedTarget)
      || containsEventTarget(dropdownRef.current, relatedTarget)
    ) return;
    cancelClose();
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
    closeTimerWindowRef.current = ownerWindow ?? null;
    closeTimerRef.current = ownerWindow?.setTimeout(() => {
      if (modeRef.current === 'hover') setModeNow('closed');
      closeTimerRef.current = null;
      closeTimerWindowRef.current = null;
    }, 80) ?? null;
  }, [cancelClose, setModeNow]);
  useEffect(() => cancelClose, [cancelClose]);
  return {
    open: mode !== 'closed',
    triggerRef,
    dropdownRef,
    close,
    focusTrigger,
    reveal,
    scheduleHoverClose,
    togglePinned,
  };
}

function useSelectorListbox({
  open,
  close,
  focusTrigger,
  triggerRef,
  dropdownRef,
  optionCount,
  selectedOptionIndex,
  onSelectIndex,
}: {
  open: boolean;
  close: () => void;
  focusTrigger: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  optionCount: number;
  selectedOptionIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(selectedOptionIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (open) setActiveIndex(selectedOptionIndex);
  }, [open, selectedOptionIndex]);

  const closeAndFocusTrigger = useCallback((): void => {
    close();
    focusTrigger();
  }, [close, focusTrigger]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = triggerRef.current?.ownerDocument ?? dropdownRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) close();
    };
    ownerDocument.addEventListener('pointerdown', closeOutside, true);
    return () => ownerDocument.removeEventListener('pointerdown', closeOutside, true);
  }, [close, dropdownRef, open, triggerRef]);

  useEffect(() => {
    if (!open || optionCount === 0) return;
    const ownerDocument = triggerRef.current?.ownerDocument ?? dropdownRef.current?.ownerDocument;
    if (!ownerDocument) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!dropdownRef.current) return;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          closeAndFocusTrigger();
          return;
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex(index => (index + 1) % optionCount);
          return;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex(index => (index - 1 + optionCount) % optionCount);
          return;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          return;
        case 'End':
          event.preventDefault();
          setActiveIndex(optionCount - 1);
          return;
        case 'Enter':
          if (event.isComposing) return;
          event.preventDefault();
          onSelectIndex(activeIndexRef.current);
          return;
        default:
      }
    };

    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown, true);
  }, [closeAndFocusTrigger, dropdownRef, onSelectIndex, open, optionCount, triggerRef]);

  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const optionElements = dropdownRef.current.querySelectorAll('[role="option"]');
    const option = optionElements[activeIndex];
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, dropdownRef, open]);

  const getOptionId = useCallback((index: number): string => `${listboxId}-option-${index}`, [listboxId]);

  return {
    activeIndex,
    getOptionId,
    listboxId,
    setActiveIndex,
  };
}

function useSelectorPortalStyle(
  open: boolean,
  portalRoot: HTMLElement | undefined,
  triggerRef: RefObject<HTMLButtonElement | null>,
  estimatedWidth: number,
): CSSProperties {
  const [portalStyle, setPortalStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (open && portalRoot && triggerRef.current) {
      setPortalStyle(getFixedDropdownStyle(triggerRef.current, estimatedWidth));
    }
  }, [estimatedWidth, open, portalRoot, triggerRef]);
  return portalStyle;
}

export function ModelSelector({
  options,
  value,
  onChange,
  portalRoot,
}: {
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
  portalRoot?: HTMLElement;
}) {
  const t = useT();
  const disclosure = useSelectorDisclosure();
  const { close, dropdownRef, focusTrigger, open, reveal, scheduleHoverClose, togglePinned, triggerRef } = disclosure;
  const portalStyle = useSelectorPortalStyle(open, portalRoot, triggerRef, 240);
  const selected = options.find(option => option.value === value) ?? options[0];
  const reversed = useMemo(() => [...options].reverse(), [options]);
  const selectedOptionIndex = useMemo(() => {
    const index = reversed.findIndex(option => option.value === value);
    return index >= 0 ? index : 0;
  }, [reversed, value]);
  const selectOptionAtIndex = useCallback((index: number): void => {
    const option = reversed[index];
    if (!option) return;
    close();
    onChange(option.value);
  }, [close, onChange, reversed]);
  const {
    activeIndex,
    getOptionId,
    listboxId,
    setActiveIndex,
  } = useSelectorListbox({
    close,
    dropdownRef,
    focusTrigger,
    onSelectIndex: selectOptionAtIndex,
    open,
    optionCount: reversed.length,
    selectedOptionIndex,
    triggerRef,
  });
  const dropdown = (
    <div
      aria-activedescendant={open ? getOptionId(activeIndex) : undefined}
      aria-hidden={!open}
      aria-label={t('chat.composer.modelAria')}
      className={`pivi-model-dropdown${portalRoot ? ' pivi-inline-selector-portal pivi-inline-selector-dropdown-fixed' : ''}`}
      id={listboxId}
      onMouseEnter={reveal}
      onMouseLeave={(event) => scheduleHoverClose(event.relatedTarget)}
      ref={dropdownRef}
      role="listbox"
      style={portalRoot ? portalStyle : undefined}
      tabIndex={-1}
    >
      {reversed.map((option, index) => {
        const showGroup = Boolean(option.group && option.group !== reversed[index - 1]?.group);
        const isHighlighted = index === activeIndex;
        const isSelected = option.value === value;
        return (
          <Fragment key={option.value}>
            {showGroup ? <div className="pivi-model-group">{option.group}</div> : null}
            <button
              aria-selected={isSelected}
              className={`pivi-model-option${isSelected ? ' selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
              id={getOptionId(index)}
              onClick={(event) => {
                close();
                event.currentTarget.blur();
                onChange(option.value);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              title={option.description}
              type="button"
            >
              <ModelOptionIcon option={option} />
              <span className="pivi-model-option-label">{option.label}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
  return (
    <div
      className={`pivi-model-selector${open ? ' is-open' : ''}`}
      onFocusCapture={reveal}
      onMouseEnter={reveal}
      onMouseLeave={(event) => scheduleHoverClose(event.relatedTarget)}
    >
      <button aria-expanded={open} aria-haspopup="listbox" aria-label={t('chat.composer.modelAria')} className="pivi-model-btn" onClick={togglePinned} ref={triggerRef} type="button">
        {selected ? <ModelOptionIcon option={selected} /> : null}
        <span className="pivi-model-label">{selected?.label ?? 'Unknown'}</span>
        <span className="pivi-model-chevron">
          <PlatformIcon name="chevron-down" />
        </span>
      </button>
      {portalRoot ? (open ? createPortal(dropdown, portalRoot) : null) : dropdown}
    </div>
  );
}

export function ThinkingSelector({
  adaptive,
  defaultValue,
  options,
  value,
  onChange,
  portalRoot,
}: {
  adaptive: boolean;
  defaultValue: string;
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
  portalRoot?: HTMLElement;
}) {
  const t = useT();
  const disclosure = useSelectorDisclosure();
  const { close, dropdownRef, focusTrigger, open, reveal, scheduleHoverClose, togglePinned, triggerRef } = disclosure;
  const portalStyle = useSelectorPortalStyle(open, portalRoot, triggerRef, 140);
  const reversed = useMemo(() => [...options].reverse(), [options]);
  const selectedOptionIndex = useMemo(() => {
    const index = reversed.findIndex(option => option.value === value);
    return index >= 0 ? index : 0;
  }, [reversed, value]);
  const selectOptionAtIndex = useCallback((index: number): void => {
    const option = reversed[index];
    if (!option) return;
    close();
    onChange(option.value);
  }, [close, onChange, reversed]);
  const {
    activeIndex,
    getOptionId,
    listboxId,
    setActiveIndex,
  } = useSelectorListbox({
    close,
    dropdownRef,
    focusTrigger,
    onSelectIndex: selectOptionAtIndex,
    open,
    optionCount: reversed.length,
    selectedOptionIndex,
    triggerRef,
  });
  if (options.length === 0 || (options.length === 1 && options[0]?.value === defaultValue)) return null;
  const selected = options.find(option => option.value === value) ?? options[0];
  const fallbackLabel = adaptive ? 'High' : 'Off';
  const dropdown = (
    <div
      aria-activedescendant={open ? getOptionId(activeIndex) : undefined}
      aria-hidden={!open}
      aria-label={t('chat.composer.reasoningAria')}
      className={`pivi-thinking-options${portalRoot ? ' pivi-inline-selector-portal pivi-inline-selector-dropdown-fixed' : ''}`}
      id={listboxId}
      onMouseEnter={reveal}
      onMouseLeave={(event) => scheduleHoverClose(event.relatedTarget)}
      ref={dropdownRef}
      role="listbox"
      style={portalRoot ? portalStyle : undefined}
      tabIndex={-1}
    >
      {reversed.map((option, index) => {
        const isHighlighted = index === activeIndex;
        const isSelected = option.value === value;
        return (
          <button
            aria-selected={isSelected}
            className={`pivi-thinking-gear${isSelected ? ' selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
            id={getOptionId(index)}
            key={option.value}
            onClick={(event) => {
              close();
              event.currentTarget.blur();
              onChange(option.value);
            }}
            onMouseEnter={() => setActiveIndex(index)}
            role="option"
            tabIndex={-1}
            title={getThinkingOptionTitle(option)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="pivi-thinking-selector">
      <div className={adaptive ? 'pivi-thinking-effort' : 'pivi-thinking-budget'}>
        <div
          className={`pivi-thinking-gears${open ? ' is-open' : ''}`}
          onFocusCapture={reveal}
          onMouseEnter={reveal}
          onMouseLeave={(event) => scheduleHoverClose(event.relatedTarget)}
        >
          <button aria-expanded={open} aria-haspopup="listbox" aria-label={t('chat.composer.reasoningAria')} className="pivi-thinking-current" onClick={togglePinned} ref={triggerRef} type="button">
            <span className="pivi-thinking-label">{selected?.label ?? fallbackLabel}</span>
            <span className="pivi-thinking-chevron">
              <PlatformIcon name="chevron-down" />
            </span>
          </button>
          {portalRoot ? (open ? createPortal(dropdown, portalRoot) : null) : dropdown}
        </div>
      </div>
    </div>
  );
}

export function ModeSelector({
  activeValue,
  label,
  options,
  value,
  onChange,
}: {
  activeValue: string | null;
  label: string | null;
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  if (options.length !== 2) return null;
  const active = options.find(option => option.value === activeValue) ?? options[1];
  const inactive = active?.value === options[0]?.value ? options[1] : options[0];
  const selected = options.find(option => option.value === value) ?? options[0];
  if (!active || !inactive || !selected) return null;
  const isActive = selected.value === active.value;
  const title = [`${inactive.label} <-> ${active.label}`, selected.description].filter(Boolean).join('\n');
  return (
    <button className="pivi-mode-selector" onClick={() => onChange(isActive ? inactive.value : active.value)} title={title} type="button">
      <span className={`pivi-mode-label${isActive ? ' active' : ''}`}>{selected.label || label}</span>
      <span aria-hidden="true" className={`pivi-toggle-switch${isActive ? ' active' : ''}`} />
    </button>
  );
}

export function ExternalContextControl({
  snapshot,
  actions,
}: {
  snapshot: ChatUiSnapshot;
  actions: ComposerChromeActions;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const updateDropdownMaxWidth = useCallback((): void => {
    const container = containerRef.current;
    const dropdown = dropdownRef.current;
    if (!container || !dropdown) return;
    const ownerWindow = container.ownerDocument.defaultView ?? window;
    const left = container.getBoundingClientRect().left;
    const availableWidth = Math.max(0, ownerWindow.innerWidth - left - 20);
    dropdown.style.setProperty('--pivi-external-context-max-width', `${availableWidth}px`);
  }, []);
  const handleReveal = useCallback((): void => {
    updateDropdownMaxWidth();
  }, [updateDropdownMaxWidth]);
  useEffect(() => {
    updateDropdownMaxWidth();
  }, [updateDropdownMaxWidth]);
  const external = snapshot.externalContext;
  const count = external.availableSelectedCount === external.selectedCount
    ? String(external.selectedCount)
    : `${external.availableSelectedCount}/${external.selectedCount}`;
  const title = external.selectedCount > 0
    ? t('chat.toolbar.externalActiveTitle', { count: String(external.selectedCount) })
    : t('chat.toolbar.externalIdleTitle');
  return (
    <div
      className="pivi-external-context-selector"
      onFocusCapture={handleReveal}
      onMouseEnter={handleReveal}
      ref={containerRef}
    >
      <button
        aria-label={title}
        className={`pivi-external-context-btn${external.selectedCount > 0 ? ' active' : ''}`}
        title={title}
        type="button"
      >
        <span className="pivi-external-context-icon">
          <PlatformIcon name="database-search" />
        </span>
        <span className={`pivi-external-context-count${external.availableSelectedCount !== external.selectedCount ? ' has-unavailable' : ''}`}>{count}</span>
      </button>
      <div className="pivi-external-context-dropdown" ref={dropdownRef}>
        <div className="pivi-external-context-header">{t('chat.toolbar.externalContexts')}</div>
        <div className="pivi-external-context-list">{external.items.length === 0 ? <div className="pivi-external-context-empty">{t('chat.toolbar.externalEmpty')}</div> : external.items.map(item => (
          <div aria-checked={item.checked} aria-label={t('chat.toolbar.externalPathAria', { path: item.displayPath })} className={`pivi-external-context-item${item.checked ? ' enabled' : ''}${item.pinned ? '' : ' has-remove'}${item.available ? '' : ' unavailable'}`} key={item.path} onClick={() => actions.toggleExternalPath(item.path)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actions.toggleExternalPath(item.path); } }} role="checkbox" tabIndex={0}>
            <input checked={item.checked} className="pivi-external-context-checkbox" readOnly tabIndex={-1} type="checkbox" />
            <span className="pivi-external-context-text" title={item.path}>{item.displayPath}</span>
            {!item.available ? <span aria-label={t('chat.toolbar.externalUnavailable', { reason: item.unavailableReason ?? '' })} className="pivi-external-context-warning"><PlatformIcon name="triangle-alert" /></span> : null}
            <button aria-label={item.pinned ? t('chat.toolbar.externalUnpin', { path: item.displayPath }) : t('chat.toolbar.externalPin', { path: item.displayPath })} className="pivi-external-context-action pivi-external-context-pin" onClick={event => { event.stopPropagation(); actions.toggleExternalPinned(item.path); }} type="button"><PlatformIcon name={item.pinned ? 'pin-off' : 'pin'} /></button>
            {!item.pinned ? <button aria-label={t('chat.toolbar.externalRemove')} className="pivi-external-context-action pivi-external-context-remove" onClick={event => { event.stopPropagation(); actions.removeExternalPath(item.path); }} type="button"><PlatformIcon name="x" /></button> : null}
          </div>
        ))}</div>
        <button className="pivi-external-context-add" onClick={actions.addExternalContext} type="button"><span className="pivi-external-context-add-icon"><PlatformIcon name="folder-plus" /></span>{t('chat.toolbar.externalAdd')}</button>
      </div>
    </div>
  );
}
