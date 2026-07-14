import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatUiSnapshot, ComposerOptionSnapshot, DeepReadonly } from '../../store';
import type { ComposerChromeActions } from '../activeChatUiBridge';
import { ModelOptionIcon } from '../ModelOptionIcon';

export function ModelSelector({
  options,
  value,
  onChange,
}: {
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value) ?? options[0];
  const reversed = useMemo(() => [...options].reverse(), [options]);
  return (
    <div
      className={`pivi-model-selector${open ? ' is-open' : ''}`}
      onFocusCapture={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button aria-expanded={open} aria-label={t('chat.composer.modelAria')} className="pivi-model-btn" onClick={() => setOpen(true)} type="button">
        {selected ? <ModelOptionIcon option={selected} /> : null}
        <span className="pivi-model-label">{selected?.label ?? 'Unknown'}</span>
      </button>
      <div aria-hidden={!open} className="pivi-model-dropdown">
        {reversed.map((option, index) => {
          const showGroup = Boolean(option.group && option.group !== reversed[index - 1]?.group);
          return (
            <Fragment key={option.value}>
              {showGroup ? <div className="pivi-model-group">{option.group}</div> : null}
              <button
                aria-pressed={option.value === value}
                className={`pivi-model-option${option.value === value ? ' selected' : ''}`}
                onClick={(event) => {
                  setOpen(false);
                  event.currentTarget.blur();
                  onChange(option.value);
                }}
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
    </div>
  );
}

export function ThinkingSelector({
  adaptive,
  defaultValue,
  options,
  value,
  onChange,
}: {
  adaptive: boolean;
  defaultValue: string;
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const reversed = useMemo(() => [...options].reverse(), [options]);
  if (options.length === 0 || (options.length === 1 && options[0]?.value === defaultValue)) return null;
  const selected = options.find(option => option.value === value) ?? options[0];
  const fallbackLabel = adaptive ? 'High' : 'Off';
  return (
    <div className="pivi-thinking-selector">
      <div className={adaptive ? 'pivi-thinking-effort' : 'pivi-thinking-budget'}>
        <div
          className={`pivi-thinking-gears${open ? ' is-open' : ''}`}
          onFocusCapture={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <button aria-expanded={open} aria-label={t('chat.composer.reasoningAria')} className="pivi-thinking-current" onClick={() => setOpen(true)} type="button">
            <span className="pivi-thinking-label">{selected?.label ?? fallbackLabel}</span>
          </button>
          <div aria-hidden={!open} className="pivi-thinking-options">
            {reversed.map(option => {
              const tokenTitle = option.tokens === undefined
                ? option.description
                : option.tokens > 0
                  ? `${option.tokens.toLocaleString()} tokens`
                  : 'Disabled';
              return (
                <button
                  aria-pressed={option.value === value}
                  className={`pivi-thinking-gear${option.value === value ? ' selected' : ''}`}
                  key={option.value}
                  onClick={(event) => {
                    setOpen(false);
                    event.currentTarget.blur();
                    onChange(option.value);
                  }}
                  title={tokenTitle}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
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
