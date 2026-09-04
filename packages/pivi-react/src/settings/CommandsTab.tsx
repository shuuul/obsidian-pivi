import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import { useHostTerminology } from '../platform';
import type {
  SettingsFeedbackMessage,
  SettingsMentionEditorHandle,
  SettingsMentionEditorPort,
  SettingsPorts,
} from '../ports';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../reorder/useSortableReorder';
import { CommandIconPicker } from './commands/CommandIconPicker';
import {
  DisclosureCard,
  SettingRow,
  SettingsCollection,
  SettingsFeedback,
  SettingsPage,
  SettingsRemoveButton,
  SettingsSection,
} from './primitives';

function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+/g, '')
    .slice(0, 128);
}

function commandKey(entry: SlashCatalogEntry): string {
  return entry.integrationKey ?? entry.persistenceKey ?? entry.id;
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

interface CommandCardProps {
  readonly entry?: SlashCatalogEntry;
  readonly expanded: boolean;
  readonly existingIds: ReadonlySet<string>;
  readonly iconNames: readonly string[];
  readonly pending: boolean;
  readonly feedback?: SettingsFeedbackMessage;
  readonly mentionEditor: SettingsMentionEditorPort;
  readonly position?: number;
  readonly dragging?: boolean;
  readonly dragOffset?: number;
  readonly dropIndicatorEdge?: 'before' | 'after';
  readonly reorderHandleProps?: SortableReorderHandleProps<HTMLElement>;
  readonly suppressReorderClick?: () => boolean;
  readonly onToggle: () => void;
  readonly onCancelDraft: () => void;
  readonly onDelete: (entry: SlashCatalogEntry) => void;
  readonly onSave: (entry: SlashCatalogEntry, previous: SlashCatalogEntry | undefined) => Promise<SlashCatalogEntry>;
}

function CommandCard({
  entry: initialEntry,
  expanded,
  existingIds,
  iconNames,
  pending,
  feedback,
  mentionEditor,
  position,
  dragging = false,
  dragOffset = 0,
  dropIndicatorEdge,
  reorderHandleProps,
  suppressReorderClick,
  onToggle,
  onCancelDraft,
  onDelete,
  onSave,
}: CommandCardProps) {
  const t = useT();
  const formId = useId();
  const [savedEntry, setSavedEntry] = useState(initialEntry);
  const [name, setName] = useState(initialEntry?.name ?? '');
  const [description, setDescription] = useState(initialEntry?.description ?? '');
  const [argumentHint, setArgumentHint] = useState(initialEntry?.argumentHint ?? '');
  const [icon, setIcon] = useState(initialEntry?.icon ?? 'message-square');
  const [content, setContent] = useState(initialEntry?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const isDraft = !savedEntry;

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorHandleRef = useRef<SettingsMentionEditorHandle | null>(null);

  // Mount the mention editor only when the card expands so each open starts
  // from the current persisted/draft content. Avoid re-mounting on every
  // keystroke to preserve cursor position and IME composition state.
  useEffect(() => {
    if (!expanded) return;
    const container = editorContainerRef.current;
    if (!container) return;
    const handle = mentionEditor.mount(container, content, {
      onChange: (text) => { setContent(text); setError(null); },
    });
    editorHandleRef.current = handle;
    return () => {
      handle.destroy();
      editorHandleRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only on expand to preserve cursor and IME state
  }, [expanded]);

  useEffect(() => {
    editorHandleRef.current?.setDisabled(pending);
  }, [pending]);

  const submit = async (): Promise<void> => {
    const normalizedName = normalizeCommandName(name);
    if (!normalizedName) { setError(t('settings.createCommand.needName')); return; }
    if (!content.trim()) { setError(t('settings.createCommand.needTemplate')); return; }
    if (existingIds.has(normalizedName) && normalizedName !== savedEntry?.id) {
      setError(t('settings.createCommand.duplicate', { name: normalizedName }));
      return;
    }
    setError(null);
    let saved: SlashCatalogEntry;
    try {
      saved = await onSave({
      id: normalizedName,
      kind: 'command',
      name: normalizedName,
      description: description.trim() || `Custom command from ${normalizedName}.md`,
      argumentHint: argumentHint.trim() || normalizedName,
      icon,
      integrationKey: savedEntry?.integrationKey,
      content,
      scope: 'workspace',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
      persistenceKey: savedEntry?.persistenceKey,
      }, savedEntry);
    } catch {
      return;
    }
    setSavedEntry(saved);
  };

  const displayName = normalizeCommandName(name) || t('settings.createCommand.newCommand');
  const summary = description.trim() || argumentHint.trim() || undefined;

  return (
    <DisclosureCard
      name={`/${displayName}`}
      summary={summary}
      icon={<PlatformIcon name={icon} />}
      ariaLabel={isDraft ? t('settings.createCommand.titleCreate') : t('settings.createCommand.titleEdit')}
      toggleAriaLabel={!isDraft ? t('settings.slashCommandsUi.editAria', { name: displayName }) : undefined}
      open={expanded}
      onToggle={onToggle}
      sortId={savedEntry?.id}
      sortableHandleProps={isDraft ? undefined : reorderHandleProps}
      consumeClickAfterDrag={suppressReorderClick}
      dragging={dragging}
      dragOffset={dragOffset}
      dropIndicatorEdge={dropIndicatorEdge}
      showSaveAction={false}
      footerActions={(
        <>
          {isDraft
            ? (
              <button
                type="button"
                disabled={pending}
                onClick={onCancelDraft}
              >
                {t('common.cancel')}
              </button>
            )
            : null}
          <button type="submit" form={formId} disabled={pending}>{t('common.save')}</button>
          <SettingsFeedback feedback={error
            ? { kind: 'error', message: error }
            : feedback} />
        </>
      )}
      reorderLabel={position !== undefined
        ? t('settings.slashCommandsUi.reorder.handle', { name: displayName, position })
        : undefined}
      actions={isDraft
        ? undefined
        : (
          <SettingsRemoveButton
            ariaLabel={t('settings.slashCommandsUi.deleteAria', { name: displayName })}
            disabled={pending}
            onClick={() => { onDelete(savedEntry); }}
          />
        )}
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <SettingRow
          name={t('settings.createCommand.name.name')}
          description={t('settings.createCommand.name.desc')}
        >
          <input
            className="pivi-settings-control"
            autoFocus={isDraft}
            value={name}
            placeholder={t('settings.createCommand.name.placeholder')}
            onChange={(event) => { setName(normalizeCommandName(event.target.value)); setError(null); }}
            disabled={pending}
          />
        </SettingRow>
        <SettingRow
          name={t('settings.createCommand.description.name')}
          description={t('settings.createCommand.description.desc')}
        >
          <input
            className="pivi-settings-control"
            value={description}
            placeholder={t('settings.createCommand.description.placeholder')}
            onChange={(event) => { setDescription(event.target.value); setError(null); }}
            disabled={pending}
          />
        </SettingRow>
        <SettingRow
          name={t('settings.createCommand.argumentHint.name')}
          description={t('settings.createCommand.argumentHint.desc')}
        >
          <input
            className="pivi-settings-control"
            value={argumentHint}
            onChange={(event) => { setArgumentHint(event.target.value); setError(null); }}
            disabled={pending}
          />
        </SettingRow>
        <SettingRow
          stacked
          name={t('settings.createCommand.template.name')}
          description={t('settings.createCommand.template.desc')}
        >
          <div
            ref={editorContainerRef}
            className="pivi-settings-mention-editor-container"
            aria-label={t('settings.createCommand.template.name')}
          />
        </SettingRow>
        <SettingRow
          name={t('settings.createCommand.icon.name')}
          description={t('settings.createCommand.icon.desc')}
        >
          <CommandIconPicker disabled={pending} icon={icon} iconNames={iconNames} onChange={setIcon} />
        </SettingRow>
      </form>
    </DisclosureCard>
  );
}

export function CommandsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { workspaceName } = useHostTerminology();
  const mounted = useMountedRef();
  const [entries, setEntries] = useState<readonly SlashCatalogEntry[] | null>(null);
  const [catalogRevision, setCatalogRevision] = useState<number | null>(null);
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [draftOpen, setDraftOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<Readonly<Record<string, SettingsFeedbackMessage>>>({});
  const [order, setOrder] = useState<readonly string[]>([]);
  const iconNames = ports.complex.commands.listIconNames();

  const load = useCallback(async () => {
    setError(null);
    try {
      await ports.complex.commands.refresh();
      const [snapshot, catalogEntries] = await Promise.all([
        ports.complex.commands.loadWorkspaceCatalog(),
        ports.complex.commands.listDropdownEntries(),
      ]);
      if (mounted.current) {
        const next = snapshot.entries;
        setEntries(next);
        setCatalogRevision(snapshot.catalogRevision);
        setOrder(next.map(entry => entry.id));
        setExistingIds(new Set(catalogEntries.map(entry => entry.id)));
      }
    } catch (cause) {
      if (mounted.current) setError(t('settings.slashCommandsUi.loadFailed', {
        message: cause instanceof Error ? cause.message : String(cause),
      }));
    }
  }, [mounted, ports.complex.commands, t]);
  useEffect(() => { void load(); }, [load]);

  const toggleExpanded = (key: string): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async (entry: SlashCatalogEntry, previous: SlashCatalogEntry | undefined): Promise<SlashCatalogEntry> => {
    setPending(true);
    const previousKey = previous ? commandKey(previous) : '__draft__';
    setCommandFeedback(current => {
      const next = { ...current };
      delete next[previousKey];
      return next;
    });
    let saved: SlashCatalogEntry;
    try {
      if (catalogRevision === null) throw new Error('Command catalog is not loaded.');
      saved = previous && previous.id !== entry.id
        ? await ports.complex.commands.renameWorkspaceEntry(previous, entry, catalogRevision)
        : await ports.complex.commands.saveWorkspaceEntry(entry, catalogRevision);
    } catch (cause) {
      if (mounted.current) {
        ports.feedback.notify(t('settings.createCommand.saveFailed'));
        setPending(false);
      }
      throw cause;
    }

    if (mounted.current) {
      setDraftOpen(false);
      setExpanded(current => {
        const next = new Set(current);
        next.delete(commandKey(saved));
        if (previous && commandKey(previous) !== commandKey(saved)) next.delete(commandKey(previous));
        return next;
      });
      setEntries(current => {
        const list = current ?? [];
        if (!previous) return [...list, saved];
        return list.map(item => item.id === previous.id ? saved : item);
      });
      setOrder(current => previous
        ? current.map(id => id === previous.id ? saved.id : id)
        : [...current, saved.id]);
      setExistingIds(current => {
        const next = new Set(current);
        if (previous && previous.id !== saved.id) next.delete(previous.id);
        next.add(saved.id);
        return next;
      });
      try {
        const snapshot = await ports.complex.commands.loadWorkspaceCatalog();
        if (mounted.current) setCatalogRevision(snapshot.catalogRevision);
      } catch {
        if (mounted.current) setCatalogRevision(current => current === null ? current : current + 1);
      }
      if (mounted.current) setPending(false);
    }
    return saved;
  };

  const remove = async (entry: SlashCatalogEntry) => {
    setPending(true);
    try {
      if (catalogRevision === null) throw new Error('Command catalog is not loaded.');
      const outcome = await ports.complex.commands.deleteWorkspaceEntry(entry, catalogRevision);
      if (mounted.current) {
        setEntries(current => (current ?? []).filter(item => item.id !== entry.id));
        setOrder(current => current.filter(id => id !== entry.id));
        setExistingIds(current => {
          const next = new Set(current);
          next.delete(entry.id);
          return next;
        });
        setExpanded(current => {
          const next = new Set(current);
          next.delete(commandKey(entry));
          return next;
        });
      }
      try {
        const snapshot = await ports.complex.commands.loadWorkspaceCatalog();
        if (mounted.current) setCatalogRevision(snapshot.catalogRevision);
      } catch {
        if (mounted.current) setCatalogRevision(current => current === null ? current : current + 1);
      }
      if (outcome.warnings?.length) ports.feedback.notify(outcome.warnings.join(' '));
    } catch (cause) {
      ports.feedback.notify(t('settings.slashCommandsUi.deleteFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      if (mounted.current) {
        setPending(false);
      }
    }
  };

  const entryById = useMemo(
    () => new Map((entries ?? []).map(entry => [entry.id, entry] as const)),
    [entries],
  );

  const reorder = useSortableReorder<string, HTMLElement>({
    order,
    disabled: pending || order.length < 2,
    itemSelector: '[data-settings-sort-id]',
    itemDataKey: 'settingsSortId',
    setOrder: (ids) => { setOrder(ids); },
    commitOrder: async (ids, originalOrder) => {
      setPending(true);
      try {
        if (catalogRevision === null) throw new Error('Command catalog is not loaded.');
        await ports.complex.commands.saveWorkspaceOrder(ids, catalogRevision);
        const snapshot = await ports.complex.commands.loadWorkspaceCatalog();
        if (mounted.current) {
          setEntries(snapshot.entries);
          setCatalogRevision(snapshot.catalogRevision);
          setOrder(snapshot.entries.map(entry => entry.id));
        }
        return true;
      } catch (cause) {
        setOrder([...originalOrder]);
        ports.feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
        return false;
      } finally {
        setPending(false);
      }
    },
    positionAnnouncement: (id, position, total) => t('settings.slashCommandsUi.reorder.position', { name: id, position, total }),
    savedAnnouncement: t('settings.slashCommandsUi.reorder.saved'),
    cancelledAnnouncement: t('settings.slashCommandsUi.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });

  return (
    <SettingsPage description={<p>{t('settings.slashCommands.desc', { workspaceName })}</p>}>
      {error ? <p className="pivi-setting-description" role="alert">{error}</p> : null}
      <SettingsSection title={t('settings.slashCommandsUi.heading')}>
        {entries === null
          ? <p className="pivi-setting-description">{t('settings.slashCommandsUi.loading')}</p>
          : (
            <SettingsCollection
              listRef={reorder.listRef}
              announcement={reorder.announcement}
              emptyState={entries.length === 0 && !draftOpen ? t('settings.slashCommandsUi.empty') : undefined}
              addLabel={t('settings.slashCommandsUi.add')}
              addAriaLabel={t('settings.slashCommandsUi.addAria')}
              addDisabled={pending || draftOpen}
              onAdd={() => { setDraftOpen(true); }}
            >
              {order.map((id, index) => {
                const entry = entryById.get(id);
                if (!entry) return null;
                const key = commandKey(entry);
                return (
                  <CommandCard
                    key={key}
                    entry={entry}
                    expanded={expanded.has(key)}
                    existingIds={existingIds}
                    iconNames={iconNames}
                    pending={pending}
                    feedback={commandFeedback[key]}
                    mentionEditor={ports.mentionEditor}
                    position={index + 1}
                    dragging={reorder.draggingId === id}
                    dragOffset={reorder.draggingId === id ? reorder.dragOffset : 0}
                    dropIndicatorEdge={reorder.dropIndicator?.id === id
                      ? reorder.dropIndicator.edge
                      : undefined}
                    reorderHandleProps={reorder.getHandleProps(id)}
                    suppressReorderClick={() => reorder.consumeClickAfterDrag(id)}
                    onToggle={() => toggleExpanded(key)}
                    onCancelDraft={() => undefined}
                    onDelete={(entry) => { void remove(entry); }}
                    onSave={save}
                  />
                );
              })}
              {draftOpen
                ? (
                  <CommandCard
                    expanded
                    existingIds={existingIds}
                    iconNames={iconNames}
                    pending={pending}
                    feedback={commandFeedback.__draft__}
                    mentionEditor={ports.mentionEditor}
                    onToggle={() => undefined}
                    onCancelDraft={() => setDraftOpen(false)}
                    onDelete={() => undefined}
                    onSave={save}
                  />
                )
                : null}
            </SettingsCollection>
          )}
      </SettingsSection>
    </SettingsPage>
  );
}
