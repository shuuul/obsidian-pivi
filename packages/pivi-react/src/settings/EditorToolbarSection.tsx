import type {
  EditorCommandId,
  EditorSelectionToolbarSettings,
  EditorToolbarShortcut,
} from '@pivi/agent/settings/types';
import { EDITOR_COMMANDS } from '@pivi/agent/settings/types';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type {
  SettingsActionsPort,
  SettingsEditorToolbarPiviCommandEntry,
  SettingsEditorToolbarPort,
  SettingsFeedbackPort,
} from '../ports';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../reorder/useSortableReorder';
import { CommandIconPicker } from './commands/CommandIconPicker';
import {
  EditorCommandPicker,
  ObsidianCommandPicker,
  PiviCommandPicker,
} from './EditorToolbarPickers';
import {
  DisclosureCard,
  Select,
  SettingRow,
  SettingsCollection,
  SettingsPage,
  SettingsRemoveButton,
  SettingsSection,
  Toggle,
} from './primitives';
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

function ShortcutCard({
  iconNames,
  shortcut,
  pending,
  expanded,
  position,
  dragging,
  dragOffset,
  dropIndicatorEdge,
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
  readonly dropIndicatorEdge?: 'before' | 'after';
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
  const compact = shortcut.kind !== 'pivi-command';
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
  const icon = shortcut.kind === 'pivi-action'
    ? (shortcut.actionId === 'inline-edit' ? 'pivi-p' : 'message-square-plus')
    : catalog?.icon ?? ('icon' in shortcut ? shortcut.icon : undefined)
      ?? (shortcut.kind === 'pivi-command' ? 'message-square' : 'terminal');

  const itemActions = (
    <>
      <span className="pivi-settings-chip">{kindLabel}</span>
      {removable ? (
        <SettingsRemoveButton
          ariaLabel={t('settings.editorToolbar.removeAria', { label })}
          disabled={pending}
          onClick={onRemove}
        />
      ) : null}
      <Toggle
        disabled={pending}
        checked={shortcut.enabled}
        label={t('settings.editorToolbar.itemEnabledAria', { label })}
        onChange={onToggleEnabled}
      />
    </>
  );

  if (compact) {
    return (
      <SettingRow
        name={label}
        leading={shortcut.kind === 'obsidian-command' ? (
          <CommandIconPicker
            compact
            disabled={pending}
            icon={icon}
            iconNames={iconNames}
            onChange={onIconChange}
          />
        ) : (
          <span className="pivi-toolbar-item-icon" aria-hidden="true">
            <PlatformIcon name={icon} />
          </span>
        )}
        centered
        className={`pivi-toolbar-shortcut${shortcut.enabled ? '' : ' is-disabled'}`}
        sortId={shortcut.id}
        dragging={dragging}
        dragOffset={dragOffset}
        dropIndicatorEdge={dropIndicatorEdge}
        sortableHandleProps={pending ? undefined : reorderHandleProps}
        reorderLabel={t('settings.editorToolbar.reorder.handle', { label, position })}
        actions={itemActions}
      />
    );
  }

  return (
    <DisclosureCard
      name={label}
      summary={description}
      icon={<PlatformIcon name={icon} />}
      className={`pivi-toolbar-shortcut${shortcut.enabled ? '' : ' is-disabled'}`}
      open={expanded}
      onToggle={onToggleExpanded}
      sortId={shortcut.id}
      sortableHandleProps={pending ? undefined : reorderHandleProps}
      consumeClickAfterDrag={suppressReorderClick}
      dragging={dragging}
      dragOffset={dragOffset}
      dropIndicatorEdge={dropIndicatorEdge}
      reorderLabel={t('settings.editorToolbar.reorder.handle', { label, position })}
      actions={itemActions}
    >
      <SettingRow name={t('settings.editorToolbar.executionTarget.name')}>
        <Select
          label={t('settings.editorToolbar.executionTarget.forCommand', { label })}
          disabled={pending}
          value={shortcut.executionTarget ?? 'sidebar'}
          onChange={(value) => { onExecutionTargetChange(value as 'inline-edit' | 'sidebar'); }}
        >
          <option value="sidebar">{t('settings.editorToolbar.executionTarget.sidebar')}</option>
          <option value="inline-edit">{t('settings.editorToolbar.executionTarget.inlineEdit')}</option>
        </Select>
      </SettingRow>
    </DisclosureCard>
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
    itemSelector: '[data-settings-sort-id]',
    itemDataKey: 'settingsSortId',
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
    <SettingsPage
      description={(
        <>
          <p>{t('settings.editorToolbar.desc')}</p>
          {noteToolbarActive ? (
            <p>{t('settings.editorToolbar.provider.noteToolbarActive')}</p>
          ) : null}
        </>
      )}
    >
      <SettingsSection>
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
        {toolbar.enabled ? (
          <SettingsCollection
            listRef={reorder.listRef}
            announcement={reorder.announcement}
            emptyState={toolbar.shortcuts.length === 0 ? t('settings.editorToolbar.empty') : undefined}
          >
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
                  dropIndicatorEdge={reorder.dropIndicator?.id === id
                    ? reorder.dropIndicator.edge
                    : undefined}
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
          </SettingsCollection>
        ) : null}
        {toolbar.enabled && mode === 'editor-command' ? (
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
        {toolbar.enabled && mode === 'obsidian-command' ? (
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
        {toolbar.enabled && mode === 'pivi-command' ? (
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
        {toolbar.enabled && mode === 'idle' ? (
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
    </SettingsPage>
  );
}
