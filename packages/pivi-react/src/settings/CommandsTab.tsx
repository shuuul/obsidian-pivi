import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import { useHostTerminology } from '../platform';
import type { SettingsPorts } from '../ports';

function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

interface CommandModalProps {
  readonly entry?: SlashCatalogEntry;
  readonly iconNames: readonly string[];
  readonly existingIds: ReadonlySet<string>;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSave: (entry: SlashCatalogEntry, previous: SlashCatalogEntry | undefined, addToToolbar: boolean) => void;
}

interface IconPickerProps {
  readonly disabled: boolean;
  readonly icon: string;
  readonly iconNames: readonly string[];
  readonly onChange: (icon: string) => void;
}

function IconPicker({ disabled, icon, iconNames, onChange }: IconPickerProps) {
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

function CommandModal({ entry: previous, iconNames, existingIds, pending, onClose, onSave }: CommandModalProps) {
  const t = useT();
  const [name, setName] = useState(previous?.name ?? '');
  const [description, setDescription] = useState(previous?.description ?? '');
  const [argumentHint, setArgumentHint] = useState(previous?.argumentHint ?? '');
  const [icon, setIcon] = useState(previous?.icon ?? 'message-square');
  const [content, setContent] = useState(previous?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const title = previous ? t('settings.createCommand.titleEdit') : t('settings.createCommand.titleCreate');

  const submit = (addToToolbar: boolean) => {
    const normalizedName = normalizeCommandName(name);
    if (!normalizedName) { setError(t('settings.createCommand.needName')); return; }
    if (!content.trim()) { setError(t('settings.createCommand.needTemplate')); return; }
    if (!iconNames.includes(icon)) { setError(t('settings.createCommand.invalidIcon')); return; }
    if (existingIds.has(normalizedName)) { setError(t('settings.createCommand.duplicate', { name: normalizedName })); return; }
    onSave({
      id: normalizedName,
      kind: 'command',
      name: normalizedName,
      description: description.trim() || `Custom command from ${normalizedName}.md`,
      argumentHint: argumentHint.trim() || normalizedName,
      icon,
      integrationKey: previous?.integrationKey,
      content,
      scope: 'workspace',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
      persistenceKey: previous?.persistenceKey,
    }, previous, addToToolbar);
  };

  return <div className="pivi-modal-layer pivi-create-command-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="pivi-modal-backdrop" onClick={pending ? undefined : onClose} />
    <form className="pivi-modal" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
      <div className="pivi-modal__title">{title}</div>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.name.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.name.desc')}</div></div><div className="pivi-setting-row__control"><input autoFocus value={name} placeholder={t('settings.createCommand.name.placeholder')} onChange={(event) => setName(normalizeCommandName(event.target.value))} disabled={pending} /></div></label>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.description.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.description.desc')}</div></div><div className="pivi-setting-row__control"><input value={description} placeholder={t('settings.createCommand.description.placeholder')} onChange={(event) => setDescription(event.target.value)} disabled={pending} /></div></label>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.argumentHint.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.argumentHint.desc')}</div></div><div className="pivi-setting-row__control"><input value={argumentHint} onChange={(event) => setArgumentHint(event.target.value)} disabled={pending} /></div></label>
      <div className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.icon.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.icon.desc')}</div></div><div className="pivi-setting-row__control pivi-command-icon-control"><IconPicker disabled={pending} icon={icon} iconNames={iconNames} onChange={setIcon} /></div></div>
      <label className="pivi-setting-row"><div className="pivi-setting-row__info"><div className="pivi-setting-row__name">{t('settings.createCommand.template.name')}</div><div className="pivi-setting-description">{t('settings.createCommand.template.desc')}</div></div><div className="pivi-setting-row__control"><textarea className="pivi-template-textarea" rows={6} value={content} onChange={(event) => setContent(event.target.value)} disabled={pending} /></div></label>
      {error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}
      <div className="pivi-modal__actions"><button type="button" onClick={onClose} disabled={pending}>{t('common.cancel')}</button><button type="button" disabled={pending} onClick={() => submit(true)}>{previous ? t('settings.createCommand.saveAndAdd') : t('settings.createCommand.createAndAdd')}</button><button className="pivi-button--primary" type="submit" disabled={pending}>{previous ? t('common.save') : t('common.create')}</button></div>
    </form>
  </div>;
}

export function CommandsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { workspaceName } = useHostTerminology();
  const mounted = useMountedRef();
  const [entries, setEntries] = useState<readonly SlashCatalogEntry[] | null>(null);
  const [internalEntries, setInternalEntries] = useState<readonly SlashCatalogEntry[]>([]);
  const [modalEntry, setModalEntry] = useState<SlashCatalogEntry | null | undefined>(undefined);
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<SlashCatalogEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
        setInternalEntries(catalogEntries.filter(
          (entry) => entry.kind === 'command' && entry.scope === 'builtin',
        ));
      }
    } catch (cause) {
      if (mounted.current) {
        setError(t('settings.slashCommandsUi.loadFailed', {
          message: cause instanceof Error ? cause.message : String(cause),
        }));
      }
    }
  }, [mounted, ports.complex.commands, t]);
  useEffect(() => { void load(); }, [load]);

  const openModal = async (entry?: SlashCatalogEntry) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.commands.refresh();
      const dropdownEntries = await ports.complex.commands.listDropdownEntries();
      const ids = new Set(dropdownEntries.filter((candidate) => !(entry && candidate.scope === 'workspace' && candidate.id === entry.id && candidate.persistenceKey === entry.persistenceKey)).map((candidate) => candidate.id));
      if (mounted.current) { setExistingIds(ids); setModalEntry(entry ?? null); }
    } catch (cause) {
      if (mounted.current) setError(t('settings.slashCommandsUi.loadFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally { if (mounted.current) setPending(false); }
  };

  const save = async (entry: SlashCatalogEntry, previous: SlashCatalogEntry | undefined, addToToolbar: boolean) => {
    setPending(true);
    setError(null);
    try {
      const saved = await ports.complex.commands.saveWorkspaceEntry(entry);
      if (previous && previous.id !== entry.id) await ports.complex.commands.deleteWorkspaceEntry(previous);
      if (mounted.current) setModalEntry(undefined);
      const setupResult = addToToolbar
        ? await ports.complex.commands.setupNoteToolbar(saved)
        : null;
      await ports.complex.commands.refresh();
      if (mounted.current) {
        setStatusMessage(setupResult?.message ?? null);
        await load();
      }
    } catch {
      if (mounted.current) setError(t('settings.createCommand.saveFailed'));
    } finally { if (mounted.current) setPending(false); }
  };

  const remove = async (entry: SlashCatalogEntry) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.commands.deleteWorkspaceEntry(entry);
      await ports.complex.commands.refresh();
      if (mounted.current) await load();
    } catch (cause) {
      if (mounted.current) setError(t('settings.slashCommandsUi.deleteFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmDelete(null);
      }
    }
  };

  const renderEntry = (entry: SlashCatalogEntry, readOnly: boolean) => (
    <div className="pivi-sp-item" key={`${entry.scope}:${entry.id}:${entry.persistenceKey ?? ''}`}>
      <div className="pivi-sp-info">
        <div className="pivi-sp-item-header">
          {entry.icon ? <PlatformIcon name={entry.icon} /> : null}
          <span className="pivi-sp-item-name">/{entry.name}</span>
          {entry.argumentHint ? <span className="pivi-slash-item-hint">{entry.argumentHint}</span> : null}
        </div>
        {entry.description ? <div className="pivi-sp-item-desc">{entry.description}</div> : null}
      </div>
      {!readOnly
        ? <div className="pivi-sp-item-actions">
          <button className="pivi-settings-action-btn" type="button" aria-label={t('settings.slashCommandsUi.editAria', { name: entry.name })} disabled={pending} onClick={() => { void openModal(entry); }}><PlatformIcon name="pencil" /></button>
          <button className="pivi-settings-action-btn pivi-settings-delete-btn" type="button" aria-label={t('settings.slashCommandsUi.deleteAria', { name: entry.name })} disabled={pending} onClick={() => setConfirmDelete(entry)}><PlatformIcon name="trash-2" /></button>
        </div>
        : null}
    </div>
  );

  return <>
    <div className="pivi-sp-settings-desc">
      <p className="pivi-setting-description">{t('settings.slashCommands.desc', { workspaceName })}</p>
    </div>
    {error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}
    {statusMessage ? <div className="pivi-setting-description" role="status">{statusMessage}</div> : null}
    <div className="pivi-slash-settings-container">
      {internalEntries.length > 0
        ? <>
          <div className="pivi-sp-header">
            <span className="pivi-sp-label">{t('settings.slashCommandsUi.internalHeading')}</span>
          </div>
          <div className="pivi-sp-list pivi-sp-list--internal">
            {internalEntries.map(entry => renderEntry(entry, true))}
          </div>
        </>
        : null}
      <div className="pivi-sp-header">
        <span className="pivi-sp-label">{t('settings.slashCommandsUi.heading')}</span>
        <div className="pivi-sp-header-actions">
          <button className="pivi-settings-text-btn" type="button" aria-label={t('settings.slashCommandsUi.addAria')} disabled={pending} onClick={() => { void openModal(); }}>
            {t('settings.slashCommandsUi.add')}
          </button>
        </div>
      </div>
      {entries === null
        ? <p className="pivi-sp-empty-state">{t('settings.slashCommandsUi.loading')}</p>
        : entries.length === 0
          ? <p className="pivi-sp-empty-state">{t('settings.slashCommandsUi.empty')}</p>
          : <div className="pivi-sp-list">
            {entries.map(entry => renderEntry(entry, false))}
          </div>}
    </div>
    {modalEntry !== undefined
      ? <CommandModal entry={modalEntry ?? undefined} iconNames={iconNames} existingIds={existingIds} pending={pending} onClose={() => setModalEntry(undefined)} onSave={(entry, previous, addToToolbar) => { void save(entry, previous, addToToolbar); }} />
      : null}
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
