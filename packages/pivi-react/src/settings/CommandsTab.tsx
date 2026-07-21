import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import { useHostTerminology } from '../platform';
import type {
  SettingsFeedbackMessage,
  SettingsMentionEditorHandle,
  SettingsMentionEditorPort,
  SettingsPorts,
} from '../ports';
import { SettingsActionFeedback, SettingsListHeader, SettingsPageDescription } from './controls';

function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
}

function commandKey(entry: SlashCatalogEntry): string {
  return entry.integrationKey ?? entry.persistenceKey ?? entry.id;
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

interface CommandIconPickerProps {
  readonly disabled: boolean;
  readonly icon: string;
  readonly iconNames: readonly string[];
  readonly onChange: (icon: string) => void;
}

export function CommandIconPicker({
  disabled,
  icon,
  iconNames,
  onChange,
}: CommandIconPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visibleIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return iconNames
      .filter(name => !normalizedQuery || name.toLowerCase().includes(normalizedQuery))
      .slice(0, 150);
  }, [iconNames, query]);

  const selectIcon = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return <div className="pivi-command-icon-picker">
    <button
      type="button"
      className="pivi-command-icon-trigger"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t('settings.createCommand.icon.choose')}
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
    >
      <PlatformIcon name={icon} />
      <span>{icon}</span>
    </button>
    {open
      ? <div className="pivi-command-icon-popover" role="dialog" aria-label={t('settings.createCommand.icon.pickerTitle')} onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}>
        <input
          autoFocus
          className="pivi-settings-control pivi-settings-control--fill"
          type="search"
          value={query}
          aria-label={t('settings.createCommand.icon.search')}
          placeholder={t('settings.createCommand.icon.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {visibleIcons.length > 0
          ? <div className="pivi-command-icon-grid" role="listbox" aria-label={t('settings.createCommand.icon.results')}>
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

interface CommandCardProps {
  readonly entry?: SlashCatalogEntry;
  readonly expanded: boolean;
  readonly existingIds: ReadonlySet<string>;
  readonly iconNames: readonly string[];
  readonly pending: boolean;
  readonly feedback?: SettingsFeedbackMessage;
  readonly mentionEditor: SettingsMentionEditorPort;
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
  onToggle,
  onCancelDraft,
  onDelete,
  onSave,
}: CommandCardProps) {
  const t = useT();
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

  const stop = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

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
  return <details className="pivi-provider-card pivi-command-card" open={expanded} aria-label={isDraft ? t('settings.createCommand.titleCreate') : t('settings.createCommand.titleEdit')}>
    <summary className="pivi-provider-header pivi-command-card-header" aria-label={!isDraft ? t('settings.slashCommandsUi.editAria', { name: displayName }) : undefined} onClick={(event) => { event.preventDefault(); onToggle(); }}>
      <div className="pivi-provider-title-row">
        <PlatformIcon name={icon} />
        <span className="pivi-provider-title">/{displayName}</span>
        {argumentHint ? <span className="pivi-slash-item-hint">{argumentHint}</span> : null}
      </div>
      {isDraft
        ? <button className="pivi-provider-remove-btn" type="button" disabled={pending} onClick={(event) => { stop(event); onCancelDraft(); }}>{t('common.cancel')}</button>
        : <button className="pivi-provider-remove-btn" type="button" aria-label={t('settings.slashCommandsUi.deleteAria', { name: displayName })} disabled={pending} onClick={(event) => { stop(event); onDelete(savedEntry); }}>{t('common.remove')}</button>}
    </summary>
    <form className="pivi-provider-body pivi-command-card-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.name.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.name.desc')}</div></div><div className="pivi-setting-row__control"><input className="pivi-settings-control" autoFocus={isDraft} value={name} placeholder={t('settings.createCommand.name.placeholder')} onChange={(event) => { setName(normalizeCommandName(event.target.value)); setError(null); }} disabled={pending} /></div></label>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.description.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.description.desc')}</div></div><div className="pivi-setting-row__control"><input className="pivi-settings-control" value={description} placeholder={t('settings.createCommand.description.placeholder')} onChange={(event) => { setDescription(event.target.value); setError(null); }} disabled={pending} /></div></label>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.argumentHint.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.argumentHint.desc')}</div></div><div className="pivi-setting-row__control"><input className="pivi-settings-control" value={argumentHint} onChange={(event) => { setArgumentHint(event.target.value); setError(null); }} disabled={pending} /></div></label>
      <div className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.icon.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.icon.desc')}</div></div><div className="pivi-setting-row__control pivi-command-icon-control"><CommandIconPicker disabled={pending} icon={icon} iconNames={iconNames} onChange={setIcon} /></div></div>
      <label className="pivi-command-prompt-field">
        <span className="pivi-setting-row__name">{t('settings.createCommand.template.name')}</span>
        <span className="pivi-setting-description">{t('settings.createCommand.template.desc')}</span>
        <div ref={editorContainerRef} className="pivi-settings-mention-editor-container" aria-label={t('settings.createCommand.template.name')} />
      </label>
      <div className="pivi-command-card-actions">
        <button className="pivi-button--primary" type="submit" disabled={pending}>{t('common.save')}</button>
        <SettingsActionFeedback feedback={error
          ? { kind: 'error', message: error }
          : feedback} />
      </div>
    </form>
  </details>;
}

export function CommandsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { workspaceName } = useHostTerminology();
  const mounted = useMountedRef();
  const [entries, setEntries] = useState<readonly SlashCatalogEntry[] | null>(null);
  const [internalEntries, setInternalEntries] = useState<readonly SlashCatalogEntry[]>([]);
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [draftOpen, setDraftOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SlashCatalogEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<Readonly<Record<string, SettingsFeedbackMessage>>>({});
  const iconNames = ports.complex.commands.listIconNames();

  const load = useCallback(async () => {
    setError(null);
    try {
      await ports.complex.commands.refresh();
      const [next, catalogEntries] = await Promise.all([
        ports.complex.commands.listWorkspaceEntries(),
        ports.complex.commands.listDropdownEntries(),
      ]);
      if (mounted.current) {
        setEntries(next);
        setExistingIds(new Set(catalogEntries.map(entry => entry.id)));
        setInternalEntries(catalogEntries.filter(
          (entry) => entry.kind === 'command' && entry.scope === 'builtin',
        ));
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
      saved = await ports.complex.commands.saveWorkspaceEntry(entry);
      if (previous && previous.id !== saved.id) await ports.complex.commands.deleteWorkspaceEntry(previous);
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
      await load();
      setPending(false);
    }
    return saved;
  };

  const remove = async (entry: SlashCatalogEntry) => {
    setPending(true);
    try {
      await ports.complex.commands.deleteWorkspaceEntry(entry);
      await ports.complex.commands.refresh();
      if (mounted.current) await load();
    } catch (cause) {
      ports.feedback.notify(t('settings.slashCommandsUi.deleteFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmDelete(null);
      }
    }
  };

  return <>
    <SettingsPageDescription>
      <p className="pivi-setting-description">{t('settings.slashCommands.desc', { workspaceName })}</p>
    </SettingsPageDescription>
    {error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}
    <div className="pivi-slash-settings-container">
      {internalEntries.length > 0
        ? <>
          <SettingsListHeader title={t('settings.slashCommandsUi.internalHeading')} />
          <div className="pivi-sp-list pivi-sp-list--internal">
            {internalEntries.map(entry => <div className="pivi-sp-item" key={`${entry.scope}:${entry.id}`}>
              <div className="pivi-sp-info">
                <div className="pivi-sp-item-header">
                  {entry.icon ? <PlatformIcon name={entry.icon} /> : null}
                  <span className="pivi-sp-item-name">/{entry.name}</span>
                  {entry.argumentHint ? <span className="pivi-slash-item-hint">{entry.argumentHint}</span> : null}
                </div>
                {entry.description ? <div className="pivi-sp-item-desc">{entry.description}</div> : null}
              </div>
            </div>)}
          </div>
        </>
        : null}
      <SettingsListHeader
        title={t('settings.slashCommandsUi.heading')}
      />
      {entries === null
        ? <p className="pivi-sp-empty-state">{t('settings.slashCommandsUi.loading')}</p>
        : entries.length === 0 && !draftOpen
          ? <p className="pivi-sp-empty-state">{t('settings.slashCommandsUi.empty')}</p>
          : <div className="pivi-providers-list pivi-command-card-list">
            {entries.map(entry => {
              const key = commandKey(entry);
              return <CommandCard
                key={key}
                entry={entry}
                expanded={expanded.has(key)}
                existingIds={existingIds}
                iconNames={iconNames}
                pending={pending}
                feedback={commandFeedback[key]}
                mentionEditor={ports.mentionEditor}
                onToggle={() => toggleExpanded(key)}
                onCancelDraft={() => undefined}
                onDelete={setConfirmDelete}
                onSave={save}
              />;
            })}
            {draftOpen ? <CommandCard
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
            /> : null}
          </div>}
      <div className="pivi-provider-add-controls">
        <button className="pivi-provider-add-trigger" type="button" aria-label={t('settings.slashCommandsUi.addAria')} disabled={pending || draftOpen} onClick={() => { setDraftOpen(true); }}>
          {t('settings.slashCommandsUi.add')}
        </button>
      </div>
    </div>
    {confirmDelete
      ? <div className="pivi-modal-layer" role="dialog" aria-modal="true" aria-label={t('settings.slashCommandsUi.deleteConfirm', { name: confirmDelete.name })}>
        <div className="pivi-modal-backdrop" onClick={() => setConfirmDelete(null)} />
        <div className="pivi-modal">
          <p>{t('settings.slashCommandsUi.deleteConfirm', { name: confirmDelete.name })}</p>
          <div className="pivi-modal__actions">
            <button type="button" disabled={pending} onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
            <button className="pivi-button--danger" type="button" disabled={pending} onClick={() => { void remove(confirmDelete); }}>{t('common.delete')}</button>
          </div>
        </div>
      </div>
      : null}
  </>;
}
