import type {
  EditorCommandId,
  EditorSelectionToolbarSettings,
  EditorToolbarShortcut,
} from '@pivi/pivi-agent-core/foundation/settings';
import { EDITOR_COMMANDS } from '@pivi/pivi-agent-core/foundation/settings';
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type {
  SettingsActionsPort,
  SettingsEditorToolbarCommandEntry,
  SettingsEditorToolbarPiviCommandEntry,
  SettingsEditorToolbarPort,
  SettingsFeedbackPort,
} from '../ports';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../reorder/useSortableReorder';
import { CommandIconPicker } from './CommandsTab';
import { Select, SettingRow, SettingsItemActions, SettingsRemoveButton, SettingsSection, Toggle } from './controls';
import type { SettingsUiStore } from './SettingsUiStore';
import { useSettingsUiSnapshot } from './SettingsUiStore';
import type { SettingsEditorSelectionToolbarSnapshot } from './types';

function createShortcutId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneToolbarSettings(
  settings: SettingsEditorSelectionToolbarSnapshot,
): EditorSelectionToolbarSettings {
  return {
    enabled: settings.enabled,
    shortcuts: settings.shortcuts.map((shortcut) => ({ ...shortcut })),
  };
}

function syncPiviCommandShortcuts(
  shortcuts: readonly EditorToolbarShortcut[],
  commands: readonly SettingsEditorToolbarPiviCommandEntry[],
): readonly EditorToolbarShortcut[] {
  const commandByKey = new Map(commands.map(command => [command.key, command] as const));
  let changed = false;
  const synchronized = shortcuts.map((shortcut) => {
    if (shortcut.kind !== 'pivi-command' || !shortcut.piviCommandKey) return shortcut;
    const command = commandByKey.get(shortcut.piviCommandKey);
    if (!command) return shortcut;
    const label = `/${command.name}`;
    if (shortcut.label === label && shortcut.icon === command.icon) return shortcut;
    changed = true;
    const updated = { ...shortcut, label };
    if (command.icon) updated.icon = command.icon;
    else delete updated.icon;
    return updated;
  });
  return changed ? synchronized : shortcuts;
}

async function saveEditorSelectionToolbar(
  store: SettingsUiStore,
  actions: SettingsActionsPort,
  next: EditorSelectionToolbarSettings,
) {
  const previous = cloneToolbarSettings(store.getSnapshot().general.editorSelectionToolbar);
  store.updateGeneral({ editorSelectionToolbar: next });
  try {
    await actions.saveEditorSelectionToolbar(next);
  } catch (error) {
    store.updateGeneral({ editorSelectionToolbar: previous });
    throw error;
  }
}

function EditorCommandPicker({
  editorToolbar,
  existingCommandIds,
  pending,
  onSelect,
  onCancel,
}: {
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly existingCommandIds: ReadonlySet<string>;
  readonly pending: boolean;
  readonly onSelect: (command: SettingsEditorToolbarCommandEntry) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const commandGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const availableCommands = new Map(editorToolbar.listHostCommands().map(command => [command.id, command]));
    const commands = EDITOR_COMMANDS
      .map(command => ({
        ...command,
        name: availableCommands.get(command.id)?.name ?? command.id,
        available: availableCommands.has(command.id),
        added: existingCommandIds.has(command.id),
      }))
      .filter((command) => (
        !normalizedQuery
        || command.name.toLowerCase().includes(normalizedQuery)
        || command.id.includes(normalizedQuery)
      ));
    const groups = new Map<string, typeof commands>();
    for (const command of commands) {
      groups.set(command.category, [...(groups.get(command.category) ?? []), command]);
    }
    return [...groups.entries()];
  }, [editorToolbar, existingCommandIds, query]);

  return (
    <div className="pivi-editor-toolbar-picker">
      <div className="pivi-editor-toolbar-picker__heading">
        {t('settings.editorToolbar.editorCommandPickerTitle')}
      </div>
      <input
        className="pivi-settings-control pivi-settings-control--fill"
        value={query}
        aria-label={t('settings.editorToolbar.commandSearchPlaceholder')}
        placeholder={t('settings.editorToolbar.commandSearchPlaceholder')}
        disabled={pending}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
      />
      <div
        className="pivi-editor-toolbar-picker__list"
        role="listbox"
        aria-label={t('settings.editorToolbar.editorCommandPickerTitle')}
      >
        {commandGroups.length === 0 ? (
          <p className="pivi-setting-description">{t('settings.editorToolbar.noCommands')}</p>
        ) : commandGroups.map(([category, entries]) => (
          <div key={category} className="pivi-editor-toolbar-picker__group" role="group" aria-label={category}>
            <div className="pivi-editor-toolbar-picker__category">{category}</div>
            {entries?.map((command) => (
              <button
                key={command.id}
                type="button"
                className="pivi-editor-toolbar-picker__item"
                role="option"
                disabled={pending || command.added || !command.available}
                aria-selected={command.added}
                onClick={() => { onSelect(command); }}
              >
                <span className="pivi-editor-toolbar-picker__icon" aria-hidden="true">
                  <PlatformIcon name={command.icon} />
                </span>
                <span className="pivi-editor-toolbar-picker__content">
                  <span className="pivi-editor-toolbar-picker__name">{command.name}</span>
                  <span className="pivi-editor-toolbar-picker__detail">
                    {command.added
                      ? t('settings.editorToolbar.added')
                      : command.available
                        ? t('settings.editorToolbar.editorCommandDescription', { command: command.name })
                        : t('settings.editorToolbar.unavailable')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="pivi-settings-action-group">
        <button type="button" disabled={pending} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function ObsidianCommandPicker({
  editorToolbar,
  existingCommandIds,
  pending,
  onSelect,
  onCancel,
}: {
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly existingCommandIds: ReadonlySet<string>;
  readonly pending: boolean;
  readonly onSelect: (command: SettingsEditorToolbarCommandEntry) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const editorCommandIds = new Set(EDITOR_COMMANDS.map(command => command.id));
    return editorToolbar.listHostCommands()
      .filter(command => !editorCommandIds.has(command.id as EditorCommandId))
      .filter(command => !existingCommandIds.has(command.id))
      .filter((command) => (
        !normalizedQuery
        || command.name.toLowerCase().includes(normalizedQuery)
        || command.id.toLowerCase().includes(normalizedQuery)
      ));
  }, [editorToolbar, existingCommandIds, query]);
  const commands = filteredCommands.slice(0, 100);
  const truncated = filteredCommands.length > commands.length;

  return (
    <div className="pivi-editor-toolbar-picker">
      <div className="pivi-editor-toolbar-picker__heading">
        {t('settings.editorToolbar.commandPickerTitle')}
      </div>
      <input
        className="pivi-settings-control pivi-settings-control--fill"
        value={query}
        aria-label={t('settings.editorToolbar.commandSearchPlaceholder')}
        placeholder={t('settings.editorToolbar.commandSearchPlaceholder')}
        disabled={pending}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
      />
      <div
        className="pivi-editor-toolbar-picker__list"
        role="listbox"
        aria-label={t('settings.editorToolbar.commandPickerTitle')}
      >
        {commands.length === 0 ? (
          <p className="pivi-setting-description">{t('settings.editorToolbar.noCommands')}</p>
        ) : commands.map(command => (
          <button
            key={command.id}
            type="button"
            className="pivi-editor-toolbar-picker__item"
            role="option"
            disabled={pending}
            onClick={() => { onSelect(command); }}
          >
            <span className="pivi-editor-toolbar-picker__icon" aria-hidden="true">
              <PlatformIcon name={command.iconId ?? 'terminal'} />
            </span>
            <span className="pivi-editor-toolbar-picker__content">
              <span className="pivi-editor-toolbar-picker__name">{command.name}</span>
              <span className="pivi-editor-toolbar-picker__id">{command.id}</span>
            </span>
          </button>
        ))}
      </div>
      {truncated ? (
        <p className="pivi-setting-description">
          {t('settings.editorToolbar.commandsTruncated', { count: commands.length })}
        </p>
      ) : null}
      <div className="pivi-settings-action-group">
        <button type="button" disabled={pending} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function PiviCommandPicker({
  editorToolbar,
  existingKeys,
  pending,
  onSelect,
  onCancel,
}: {
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly existingKeys: ReadonlySet<string>;
  readonly pending: boolean;
  readonly onSelect: (
    command: SettingsEditorToolbarPiviCommandEntry,
    executionTarget: 'inline-edit' | 'sidebar',
  ) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<readonly SettingsEditorToolbarPiviCommandEntry[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [executionTarget, setExecutionTarget] = useState<'inline-edit' | 'sidebar'>('sidebar');

  useEffect(() => {
    let cancelled = false;
    void editorToolbar.listPiviCommands().then((entries) => {
      if (!cancelled) {
        setCommands(entries);
        setLoadError(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setCommands([]);
        setLoadError(true);
      }
    });
    return () => { cancelled = true; };
  }, [editorToolbar]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return commands
      .filter((command) => !existingKeys.has(command.key))
      .filter((command) => (
        !normalizedQuery
        || command.name.toLowerCase().includes(normalizedQuery)
        || (command.description?.toLowerCase().includes(normalizedQuery) ?? false)
      ));
  }, [commands, existingKeys, query]);

  return (
    <div className="pivi-editor-toolbar-picker">
      <div className="pivi-editor-toolbar-picker__heading">
        {t('settings.editorToolbar.piviCommandPickerTitle')}
      </div>
      <label className="pivi-setting-description pivi-editor-toolbar-picker__target">
        <span>{t('settings.editorToolbar.executionTarget.name')}</span>
        <Select
          label={t('settings.editorToolbar.executionTarget.name')}
          value={executionTarget}
          disabled={pending}
          onChange={(value) => { setExecutionTarget(value as 'inline-edit' | 'sidebar'); }}
        >
          <option value="sidebar">{t('settings.editorToolbar.executionTarget.sidebar')}</option>
          <option value="inline-edit">{t('settings.editorToolbar.executionTarget.inlineEdit')}</option>
        </Select>
      </label>
      <input
        className="pivi-settings-control pivi-settings-control--fill"
        value={query}
        aria-label={t('settings.editorToolbar.piviCommandSearchPlaceholder')}
        placeholder={t('settings.editorToolbar.piviCommandSearchPlaceholder')}
        disabled={pending}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
      />
      <div
        className="pivi-editor-toolbar-picker__list"
        role="listbox"
        aria-label={t('settings.editorToolbar.piviCommandPickerTitle')}
      >
        {loadError ? (
          <p className="pivi-setting-description">{t('common.error')}</p>
        ) : filtered.length === 0 ? (
          <p className="pivi-setting-description">{t('settings.editorToolbar.noPiviCommands')}</p>
        ) : filtered.map((command) => (
          <button
            key={command.key}
            type="button"
            className="pivi-editor-toolbar-picker__item"
            role="option"
            disabled={pending}
            onClick={() => { onSelect(command, executionTarget); }}
          >
            <span className="pivi-editor-toolbar-picker__icon" aria-hidden="true">
              <PlatformIcon name={command.icon ?? 'message-square'} />
            </span>
            <span className="pivi-editor-toolbar-picker__content">
              <span className="pivi-editor-toolbar-picker__name">/{command.name}</span>
              {command.description ? (
                <span className="pivi-editor-toolbar-picker__detail">{command.description}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
      <div className="pivi-settings-action-group">
        <button type="button" disabled={pending} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function ShortcutCard({
  iconNames,
  shortcut,
  pending,
  expanded,
  position,
  dragging,
  dragOffset,
  reorderHandleProps,
  suppressReorderClick,
  onToggleExpanded,
  onIconChange,
  onToggleEnabled,
  onExecutionTargetChange,
  description,
  editorCommandName,
  onRemove,
}: {
  readonly iconNames: readonly string[];
  readonly shortcut: EditorToolbarShortcut;
  readonly pending: boolean;
  readonly expanded: boolean;
  readonly position: number;
  readonly dragging: boolean;
  readonly dragOffset: number;
  readonly reorderHandleProps: SortableReorderHandleProps<HTMLElement>;
  readonly suppressReorderClick: () => boolean;
  readonly onToggleExpanded: () => void;
  readonly onIconChange: (icon: string) => void;
  readonly onToggleEnabled: (enabled: boolean) => void;
  readonly onExecutionTargetChange: (target: 'inline-edit' | 'sidebar') => void;
  readonly description?: string;
  readonly editorCommandName?: string;
  readonly onRemove: () => void;
}) {
  const t = useT();
  const compact = shortcut.kind === 'pivi-action' || shortcut.kind === 'editor-command';
  const removable = shortcut.kind !== 'pivi-action';
  const catalog = shortcut.kind === 'editor-command'
    ? EDITOR_COMMANDS.find(command => command.id === shortcut.commandId)
    : undefined;
  const label = shortcut.kind === 'pivi-action'
    ? t(shortcut.actionId === 'inline-edit' ? 'settings.editorToolbar.actions.inlineEdit' : 'editor.selectionToolbar.addToChat')
    : shortcut.kind === 'editor-command'
      ? editorCommandName ?? shortcut.commandId
      : shortcut.label;
  const kindLabel = shortcut.kind === 'pivi-action'
    ? t('settings.editorToolbar.kind.piviAction')
    : shortcut.kind === 'editor-command'
      ? t('settings.editorToolbar.kind.editorCommand')
      : shortcut.kind === 'obsidian-command'
        ? t('settings.editorToolbar.kind.command')
        : t('settings.editorToolbar.kind.piviCommand');
  const meta = shortcut.kind === 'obsidian-command' ? shortcut.commandId : description;
  const icon = shortcut.kind === 'pivi-action'
    ? (shortcut.actionId === 'inline-edit' ? 'pivi-p' : 'message-square-plus')
    : catalog?.icon ?? ('icon' in shortcut ? shortcut.icon : undefined)
      ?? (shortcut.kind === 'pivi-command' ? 'message-square' : 'terminal');

  const dragStyle = dragging
    ? { '--pivi-toolbar-drag-y': `${dragOffset}px` } as CSSProperties
    : undefined;
  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest('button, input, textarea, select, [contenteditable="true"], [data-toolbar-control]')) {
      return;
    }
    reorderHandleProps.onPointerDown(event);
  };

  const headerContent = (
    <>
      <button
        type="button"
        className="pivi-provider-drag-handle pivi-editor-toolbar-card__handle"
        aria-label={t('settings.editorToolbar.reorder.handle', { label, position })}
        aria-pressed={dragging}
        disabled={pending}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={reorderHandleProps.onKeyDown}
      ><span aria-hidden="true">⠿</span></button>
      <span className="pivi-provider-priority" aria-hidden="true">{position}</span>
      {shortcut.kind === 'obsidian-command' ? (
        <span
          className="pivi-editor-toolbar-card__icon-control"
          data-toolbar-control
          onClick={(event) => { event.stopPropagation(); }}
          onPointerDown={(event) => { event.stopPropagation(); }}
        >
          <CommandIconPicker
            disabled={pending}
            icon={icon}
            iconNames={iconNames}
            onChange={onIconChange}
          />
        </span>
      ) : (
        <span className="pivi-editor-toolbar-card__fixed-icon" aria-hidden="true"><PlatformIcon name={icon} /></span>
      )}
      <span className="pivi-editor-toolbar-card__label">{label}</span>
      <span className="pivi-editor-toolbar-card__badge">{kindLabel}</span>
      <SettingsItemActions className="pivi-editor-toolbar-card__actions">
        <Toggle disabled={pending} checked={shortcut.enabled} label={t('settings.editorToolbar.itemEnabledAria', { label })} onChange={onToggleEnabled} />
        {removable ? (
          <SettingsRemoveButton
            className="pivi-editor-toolbar-card__remove"
            ariaLabel={t('settings.editorToolbar.removeAria', { label })}
            disabled={pending}
            onClick={onRemove}
          />
        ) : null}
      </SettingsItemActions>
    </>
  );
  const pointerProps = {
    onPointerCancel: reorderHandleProps.onPointerCancel,
    onPointerDown: handlePointerDown,
    onPointerMove: reorderHandleProps.onPointerMove,
    onPointerUp: reorderHandleProps.onPointerUp,
  };
  if (compact) return (
    <div className={`pivi-provider-card pivi-editor-toolbar-card pivi-sortable-toolbar-card${shortcut.enabled ? '' : ' pivi-editor-toolbar-card--disabled'}${dragging ? ' is-dragging' : ''}`} data-shortcut-sort-id={shortcut.id} style={dragStyle}>
      <div className="pivi-provider-header pivi-editor-toolbar-card__header" {...pointerProps}>{headerContent}</div>
    </div>
  );

  return (
    <details
      className={`pivi-provider-card pivi-editor-toolbar-card pivi-sortable-toolbar-card${shortcut.enabled ? '' : ' pivi-editor-toolbar-card--disabled'}${dragging ? ' is-dragging' : ''}`}
      data-shortcut-sort-id={shortcut.id}
      open={expanded}
      style={dragStyle}
    >
      <summary
        className="pivi-provider-header pivi-editor-toolbar-card__header"
        onClick={(event) => {
          event.preventDefault();
          if (!suppressReorderClick()) onToggleExpanded();
        }}
        {...pointerProps}
      >
        {headerContent}
      </summary>
      <div className="pivi-provider-body pivi-editor-toolbar-card__body">
        {meta ? (
          <span className="pivi-editor-toolbar-card__meta">{meta}</span>
        ) : null}
        {shortcut.kind === 'pivi-command' ? (
          <label className="pivi-editor-toolbar-card__field">
            <span>{t('settings.editorToolbar.executionTarget.name')}</span>
            <Select
              label={t('settings.editorToolbar.executionTarget.forCommand', { label })}
              disabled={pending}
              value={shortcut.executionTarget ?? 'sidebar'}
              onChange={(value) => { onExecutionTargetChange(value as 'inline-edit' | 'sidebar'); }}
            >
              <option value="sidebar">{t('settings.editorToolbar.executionTarget.sidebar')}</option>
              <option value="inline-edit">{t('settings.editorToolbar.executionTarget.inlineEdit')}</option>
            </Select>
          </label>
        ) : null}
      </div>
    </details>
  );
}

export function EditorToolbarSection({
  store,
  actions,
  editorToolbar,
  feedback,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const { general } = useSettingsUiSnapshot(store);
  const toolbar = general.editorSelectionToolbar;
  const t = useT();
  const [mode, setMode] = useState<'idle' | 'editor-command' | 'obsidian-command' | 'pivi-command'>('idle');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [piviCommands, setPiviCommands] = useState<readonly SettingsEditorToolbarPiviCommandEntry[]>([]);
  const noteToolbarActive = editorToolbar.isNoteToolbarTextToolbarActive();
  const iconNames = editorToolbar.listIconNames();
  useEffect(() => {
    let active = true;
    void editorToolbar.listPiviCommands().then((entries) => {
      if (!active) return;
      setPiviCommands(entries);
      const current = store.getSnapshot().general;
      const shortcuts = syncPiviCommandShortcuts(current.editorSelectionToolbar.shortcuts, entries);
      if (shortcuts !== current.editorSelectionToolbar.shortcuts) {
        store.updateGeneral({
          editorSelectionToolbar: {
            ...current.editorSelectionToolbar,
            shortcuts: [...shortcuts],
          },
        });
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [editorToolbar, store]);

  const existingHostCommandIds = useMemo(
    () => new Set(
      toolbar.shortcuts
        .filter((shortcut) => shortcut.kind === 'obsidian-command' || shortcut.kind === 'editor-command')
        .map((shortcut) => shortcut.commandId),
    ),
    [toolbar.shortcuts],
  );

  const existingPiviCommandKeys = useMemo(
    () => new Set(
      toolbar.shortcuts
        .flatMap((shortcut) => shortcut.kind === 'pivi-command' ? [shortcut.piviCommandKey] : []),
    ),
    [toolbar.shortcuts],
  );

  const persist = async (next: EditorSelectionToolbarSettings): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      await saveEditorSelectionToolbar(store, actions, next);
      return true;
    } catch (cause) {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const updateShortcuts = (shortcuts: EditorToolbarShortcut[]) => {
    void persist({ enabled: toolbar.enabled, shortcuts });
  };

  const setEnabled = (enabled: boolean) => {
    setMode('idle');
    void persist({ enabled, shortcuts: [...toolbar.shortcuts] });
  };

  const toggleExpanded = (id: string, open?: boolean): void => {
    setExpanded(current => {
      const next = new Set(current);
      const shouldOpen = open ?? !next.has(id);
      if (shouldOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const shortcutById = useMemo(
    () => new Map(toolbar.shortcuts.map(shortcut => [shortcut.id, shortcut] as const)),
    [toolbar.shortcuts],
  );
  const shortcutIds = useMemo(() => toolbar.shortcuts.map(shortcut => shortcut.id), [toolbar.shortcuts]);
  const [order, setOrder] = useState<readonly string[]>(shortcutIds);
  useEffect(() => { setOrder(shortcutIds); }, [shortcutIds]);

  const reorder = useSortableReorder<string, HTMLElement>({
    order,
    disabled: pending || order.length < 2,
    itemSelector: '[data-shortcut-sort-id]',
    itemDataKey: 'shortcutSortId',
    setOrder: (ids) => { setOrder(ids); },
    commitOrder: async (ids, originalOrder) => {
      const shortcuts = ids.flatMap((id) => {
        const shortcut = shortcutById.get(id);
        return shortcut ? [shortcut] : [];
      });
      if (shortcuts.length !== toolbar.shortcuts.length) {
        setOrder([...originalOrder]);
        return false;
      }
      const saved = await persist({ enabled: toolbar.enabled, shortcuts });
      if (!saved) setOrder([...originalOrder]);
      return saved;
    },
    positionAnnouncement: (id, position, total) => t('settings.editorToolbar.reorder.position', {
      label: (() => {
        const shortcut = shortcutById.get(id);
        return shortcut?.kind === 'pivi-command' || shortcut?.kind === 'obsidian-command' ? shortcut.label : id;
      })(),
      position,
      total,
    }),
    savedAnnouncement: t('settings.editorToolbar.reorder.saved'),
    cancelledAnnouncement: t('settings.editorToolbar.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });

  return (
    <>
      <SettingsSection title={t('settings.editorToolbar.provider.title')}>
        <SettingRow
          name={t('settings.editorToolbar.provider.name')}
          description={t('settings.editorToolbar.provider.desc')}
        >
          <Toggle
            checked={toolbar.enabled}
            disabled={pending}
            label={t('settings.editorToolbar.provider.name')}
            onChange={setEnabled}
          />
        </SettingRow>
        {noteToolbarActive ? (
          <p className="pivi-setting-description">
            {t('settings.editorToolbar.provider.noteToolbarActive')}
          </p>
        ) : null}
      </SettingsSection>
      {toolbar.enabled ? (
        <SettingsSection title={t('settings.editorToolbar.title')}>
          <p className="pivi-setting-description">{t('settings.editorToolbar.desc')}</p>
          {toolbar.shortcuts.length === 0 ? (
            <p className="pivi-setting-description">{t('settings.editorToolbar.empty')}</p>
          ) : (
            <div className="pivi-editor-toolbar-cards" ref={reorder.listRef}>
              {order.map((id, index) => {
                const shortcut = shortcutById.get(id);
                if (!shortcut) return null;
                return (
                  <ShortcutCard
                    iconNames={iconNames}
                    key={shortcut.id}
                    shortcut={shortcut}
                    pending={pending}
                    expanded={expanded.has(id)}
                    position={index + 1}
                    dragging={reorder.draggingId === id}
                    dragOffset={reorder.draggingId === id ? reorder.dragOffset : 0}
                    reorderHandleProps={reorder.getHandleProps(id)}
                    suppressReorderClick={() => reorder.consumeClickAfterDrag(id)}
                    onToggleExpanded={() => { toggleExpanded(id); }}
                    description={shortcut.kind === 'pivi-command'
                      ? piviCommands.find(command => command.key === shortcut.piviCommandKey)?.description
                      : undefined}
                    editorCommandName={shortcut.kind === 'editor-command'
                      ? editorToolbar.listHostCommands().find(command => command.id === shortcut.commandId)?.name
                      : undefined}
                    onIconChange={(icon) => {
                      updateShortcuts(toolbar.shortcuts.map((entry) => (
                        entry.id === id ? { ...entry, icon } : entry
                      )));
                    }}
                    onToggleEnabled={(enabled) => {
                      updateShortcuts(toolbar.shortcuts.map((entry) => (
                        entry.id === id ? { ...entry, enabled } : entry
                      )));
                    }}
                    onExecutionTargetChange={(executionTarget) => {
                      updateShortcuts(toolbar.shortcuts.map((entry) => (
                        entry.id === id ? { ...entry, executionTarget } : entry
                      )));
                    }}
                    onRemove={() => {
                      updateShortcuts(toolbar.shortcuts.filter((entry) => entry.id !== id));
                    }}
                  />
                );
              })}
            </div>
          )}
          <div className="pivi-visually-hidden" aria-live="polite">{reorder.announcement}</div>
          {mode === 'editor-command' ? (
            <EditorCommandPicker
              editorToolbar={editorToolbar}
              existingCommandIds={existingHostCommandIds}
              pending={pending}
              onSelect={(command) => {
                const id = command.id;
                const shortcuts: EditorToolbarShortcut[] = [
                  ...toolbar.shortcuts,
                  {
                    id,
                    kind: 'editor-command' as const,
                    enabled: true,
                    commandId: command.id as EditorCommandId,
                  },
                ];
                void persist({ enabled: toolbar.enabled, shortcuts }).then((saved) => {
                  if (saved) {
                    setMode('idle');
                  }
                });
              }}
              onCancel={() => { setMode('idle'); }}
            />
          ) : null}
          {mode === 'obsidian-command' ? (
            <ObsidianCommandPicker
              editorToolbar={editorToolbar}
              existingCommandIds={existingHostCommandIds}
              pending={pending}
              onSelect={(command) => {
                const id = createShortcutId();
                const shortcuts: EditorToolbarShortcut[] = [
                  ...toolbar.shortcuts,
                  {
                    id,
                    kind: 'obsidian-command',
                    label: command.name,
                    enabled: true,
                    commandId: command.id,
                    icon: command.iconId ?? 'terminal',
                  },
                ];
                void persist({ enabled: toolbar.enabled, shortcuts }).then((saved) => {
                  if (saved) setMode('idle');
                });
              }}
              onCancel={() => { setMode('idle'); }}
            />
          ) : null}
          {mode === 'pivi-command' ? (
            <PiviCommandPicker
              editorToolbar={editorToolbar}
              existingKeys={existingPiviCommandKeys}
              pending={pending}
              onSelect={(command, executionTarget) => {
                const id = createShortcutId();
                const shortcuts = [
                  ...toolbar.shortcuts,
                  {
                    id,
                    kind: 'pivi-command' as const,
                    label: `/${command.name}`,
                    enabled: true,
                    piviCommandKey: command.key,
                    executionTarget,
                    ...(command.icon ? { icon: command.icon } : {}),
                  },
                ];
                void persist({ enabled: toolbar.enabled, shortcuts }).then((saved) => {
                  if (saved) {
                    setMode('idle');
                    toggleExpanded(id, true);
                  }
                });
              }}
              onCancel={() => { setMode('idle'); }}
            />
          ) : null}
          {mode === 'idle' ? (
            <div className="pivi-settings-action-group">
              <button
                type="button"
                className="pivi-settings-text-btn"
                disabled={pending}
                onClick={() => { setMode('editor-command'); }}
              >
                {t('settings.editorToolbar.addEditorCommand')}
              </button>
              <button
                type="button"
                className="pivi-settings-text-btn"
                disabled={pending}
                onClick={() => { setMode('obsidian-command'); }}
              >
                {t('settings.editorToolbar.addCommand')}
              </button>
              <button
                type="button"
                className="pivi-settings-text-btn"
                disabled={pending}
                onClick={() => { setMode('pivi-command'); }}
              >
                {t('settings.editorToolbar.addPiviCommand')}
              </button>
            </div>
          ) : null}
        </SettingsSection>
      ) : null}
    </>
  );
}
