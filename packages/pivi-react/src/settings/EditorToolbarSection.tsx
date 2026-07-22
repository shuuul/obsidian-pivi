import type {
  EditorSelectionToolbarSettings,
  EditorToolbarShortcut,
} from '@pivi/pivi-agent-core/foundation/settings';
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useState } from 'react';

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
import { Select, SettingRow, SettingsSection, Toggle } from './controls';
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

function HostCommandPicker({
  editorToolbar,
  existingCommandIds,
  onSelect,
  onCancel,
}: {
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly existingCommandIds: ReadonlySet<string>;
  readonly onSelect: (command: SettingsEditorToolbarCommandEntry) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const commands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return editorToolbar.listHostCommands()
      .filter((command) => !existingCommandIds.has(command.id))
      .filter((command) => (
        !normalizedQuery
        || command.name.toLowerCase().includes(normalizedQuery)
        || command.id.toLowerCase().includes(normalizedQuery)
      ))
      .slice(0, 100);
  }, [editorToolbar, existingCommandIds, query]);

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
        onChange={(event) => { setQuery(event.currentTarget.value); }}
      />
      <div
        className="pivi-editor-toolbar-picker__list"
        role="listbox"
        aria-label={t('settings.editorToolbar.commandPickerTitle')}
      >
        {commands.length === 0 ? (
          <p className="pivi-setting-description">{t('settings.editorToolbar.noCommands')}</p>
        ) : commands.map((command) => (
          <button
            key={command.id}
            type="button"
            className="pivi-editor-toolbar-picker__item"
            role="option"
            onClick={() => { onSelect(command); }}
          >
            <span className="pivi-editor-toolbar-picker__name">{command.name}</span>
            <span className="pivi-editor-toolbar-picker__id">{command.id}</span>
          </button>
        ))}
      </div>
      <div className="pivi-settings-action-group">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function PiviCommandPicker({
  editorToolbar,
  existingKeys,
  onSelect,
  onCancel,
}: {
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly existingKeys: ReadonlySet<string>;
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
      <label className="pivi-setting-description">
        {t('settings.editorToolbar.executionTarget.name')}
        <Select
          label={t('settings.editorToolbar.executionTarget.name')}
          value={executionTarget}
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
            onClick={() => { onSelect(command, executionTarget); }}
          >
            <span className="pivi-editor-toolbar-picker__name">/{command.name}</span>
            {command.description ? (
              <span className="pivi-editor-toolbar-picker__id">{command.description}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="pivi-settings-action-group">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
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
  readonly onRemove: () => void;
}) {
  const t = useT();
  const kindLabel = shortcut.kind === 'obsidian-command'
    ? t('settings.editorToolbar.kind.command')
    : t('settings.editorToolbar.kind.piviCommand');
  const meta = shortcut.kind === 'obsidian-command' ? shortcut.commandId : description;
  const icon = shortcut.icon
    ?? (shortcut.kind === 'pivi-command' ? 'message-square' : 'terminal');

  const dragStyle = dragging
    ? { '--pivi-toolbar-drag-y': `${dragOffset}px` } as CSSProperties
    : undefined;
  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    reorderHandleProps.onPointerDown(event);
  };

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
        onPointerCancel={reorderHandleProps.onPointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={reorderHandleProps.onPointerMove}
        onPointerUp={reorderHandleProps.onPointerUp}
      >
        <button
          type="button"
          className="pivi-provider-drag-handle pivi-editor-toolbar-card__handle"
          aria-label={t('settings.editorToolbar.reorder.handle', { label: shortcut.label, position })}
          aria-pressed={dragging}
          disabled={pending}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onKeyDown={reorderHandleProps.onKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <span className="pivi-provider-priority" aria-hidden="true">{position}</span>
        <span className="pivi-editor-toolbar-card__fixed-icon" aria-hidden="true">
          <PlatformIcon name={icon} />
        </span>
        <span className="pivi-editor-toolbar-card__label">{shortcut.label}</span>
        <span className="pivi-editor-toolbar-card__badge">{kindLabel}</span>
        <span
          className="pivi-editor-toolbar-card__actions"
          onClick={(event) => { event.stopPropagation(); }}
        >
          <Toggle
            checked={shortcut.enabled}
            label={t('settings.editorToolbar.enabled')}
            onChange={onToggleEnabled}
          />
          <button
            type="button"
            className="pivi-settings-action-btn pivi-editor-toolbar-card__remove"
            disabled={pending}
            aria-label={t('settings.editorToolbar.removeAria', { label: shortcut.label })}
            onClick={onRemove}
          >
            <PlatformIcon name="x" />
          </button>
        </span>
      </summary>
      <div className="pivi-provider-body pivi-editor-toolbar-card__body">
        {meta ? (
          <span className="pivi-editor-toolbar-card__meta">{meta}</span>
        ) : null}
        {shortcut.kind === 'obsidian-command' ? (
          <CommandIconPicker
            disabled={pending}
            icon={icon}
            iconNames={iconNames}
            onChange={onIconChange}
          />
        ) : null}
        {shortcut.kind === 'pivi-command' ? (
          <label className="pivi-editor-toolbar-card__field">
            <span>{t('settings.editorToolbar.executionTarget.name')}</span>
            <Select
              label={t('settings.editorToolbar.executionTarget.forCommand', { label: shortcut.label })}
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
  const [mode, setMode] = useState<'idle' | 'host-command' | 'pivi-command'>('idle');
  const [pending, setPending] = useState(false);
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
        .filter((shortcut) => shortcut.kind === 'obsidian-command' && shortcut.commandId)
        .map((shortcut) => shortcut.commandId as string),
    ),
    [toolbar.shortcuts],
  );

  const existingPiviCommandKeys = useMemo(
    () => new Set(
      toolbar.shortcuts
        .filter((shortcut) => shortcut.kind === 'pivi-command' && shortcut.piviCommandKey)
        .map((shortcut) => shortcut.piviCommandKey as string),
    ),
    [toolbar.shortcuts],
  );

  const persist = async (next: EditorSelectionToolbarSettings): Promise<boolean> => {
    setPending(true);
    try {
      await saveEditorSelectionToolbar(store, actions, next);
      return true;
    } catch (cause) {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      return false;
    } finally {
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
      label: shortcutById.get(id)?.label ?? id,
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
          {mode === 'host-command' ? (
            <HostCommandPicker
              editorToolbar={editorToolbar}
              existingCommandIds={existingHostCommandIds}
              onSelect={(command) => {
                const id = createShortcutId();
                const shortcuts = [
                  ...toolbar.shortcuts,
                  {
                    id,
                    kind: 'obsidian-command' as const,
                    label: command.name,
                    enabled: true,
                    commandId: command.id,
                    ...(command.iconId ? { icon: command.iconId } : {}),
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
          {mode === 'pivi-command' ? (
            <PiviCommandPicker
              editorToolbar={editorToolbar}
              existingKeys={existingPiviCommandKeys}
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
                onClick={() => { setMode('host-command'); }}
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
