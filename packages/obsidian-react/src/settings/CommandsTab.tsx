import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { ObsidianIcon } from '../icons';
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
  readonly existingIds: ReadonlySet<string>;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSave: (entry: SlashCatalogEntry, previous?: SlashCatalogEntry) => void;
}

function CommandModal({ entry: previous, existingIds, pending, onClose, onSave }: CommandModalProps) {
  const t = useT();
  const [name, setName] = useState(previous?.name ?? '');
  const [description, setDescription] = useState(previous?.description ?? '');
  const [argumentHint, setArgumentHint] = useState(previous?.argumentHint ?? 'text');
  const [content, setContent] = useState(previous?.content ?? 'Please analyze the following:\n{{selected_text}}');
  const [error, setError] = useState<string | null>(null);
  const title = previous ? t('settings.createCommand.titleEdit') : t('settings.createCommand.titleCreate');

  const submit = () => {
    const normalizedName = normalizeCommandName(name);
    if (!normalizedName) { setError(t('settings.createCommand.needName')); return; }
    if (!content.trim()) { setError(t('settings.createCommand.needTemplate')); return; }
    if (existingIds.has(normalizedName)) { setError(t('settings.createCommand.duplicate', { name: normalizedName })); return; }
    onSave({
      id: normalizedName,
      kind: 'command',
      name: normalizedName,
      description: description.trim() || `Custom command from ${normalizedName}.md`,
      argumentHint: argumentHint.trim() || 'text',
      content,
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
      persistenceKey: previous?.persistenceKey,
    }, previous);
  };

  return <div className="modal-container pivi-create-command-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-bg" onClick={pending ? undefined : onClose} />
    <form className="modal" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="modal-title">{title}</div>
      <label className="setting-item"><div className="setting-item-info"><div className="setting-item-name">{t('settings.createCommand.name.name')}</div><div className="setting-item-description">{t('settings.createCommand.name.desc')}</div></div><div className="setting-item-control"><input autoFocus value={name} placeholder={t('settings.createCommand.name.placeholder')} onChange={(event) => setName(normalizeCommandName(event.target.value))} disabled={pending} /></div></label>
      <label className="setting-item"><div className="setting-item-info"><div className="setting-item-name">{t('settings.createCommand.description.name')}</div><div className="setting-item-description">{t('settings.createCommand.description.desc')}</div></div><div className="setting-item-control"><input value={description} placeholder={t('settings.createCommand.description.placeholder')} onChange={(event) => setDescription(event.target.value)} disabled={pending} /></div></label>
      <label className="setting-item"><div className="setting-item-info"><div className="setting-item-name">{t('settings.createCommand.argumentHint.name')}</div><div className="setting-item-description">{t('settings.createCommand.argumentHint.desc')}</div></div><div className="setting-item-control"><input value={argumentHint} onChange={(event) => setArgumentHint(event.target.value)} disabled={pending} /></div></label>
      <label className="setting-item"><div className="setting-item-info"><div className="setting-item-name">{t('settings.createCommand.template.name')}</div><div className="setting-item-description">{t('settings.createCommand.template.desc')}</div></div><div className="setting-item-control"><textarea className="pivi-template-textarea" rows={6} value={content} onChange={(event) => setContent(event.target.value)} disabled={pending} /></div></label>
      {error ? <div className="setting-item-description" role="alert">{error}</div> : null}
      <div className="modal-button-container"><button type="button" onClick={onClose} disabled={pending}>{t('common.cancel')}</button><button className="mod-cta" type="submit" disabled={pending}>{previous ? t('common.save') : t('common.create')}</button></div>
    </form>
  </div>;
}

export function CommandsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const mounted = useMountedRef();
  const [entries, setEntries] = useState<readonly SlashCatalogEntry[] | null>(null);
  const [modalEntry, setModalEntry] = useState<SlashCatalogEntry | null | undefined>(undefined);
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<SlashCatalogEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await ports.complex.commands.refresh();
      const next = await ports.complex.commands.listVaultEntries();
      if (mounted.current) setEntries(next);
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
      const ids = new Set(dropdownEntries.filter((candidate) => !(entry && candidate.scope === 'vault' && candidate.id === entry.id && candidate.persistenceKey === entry.persistenceKey)).map((candidate) => candidate.id));
      if (mounted.current) { setExistingIds(ids); setModalEntry(entry ?? null); }
    } catch (cause) {
      if (mounted.current) setError(t('settings.slashCommandsUi.loadFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally { if (mounted.current) setPending(false); }
  };

  const save = async (entry: SlashCatalogEntry, previous?: SlashCatalogEntry) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.commands.saveVaultEntry(entry);
      if (previous && previous.id !== entry.id) await ports.complex.commands.deleteVaultEntry(previous);
      await ports.complex.commands.refresh();
      if (mounted.current) { setModalEntry(undefined); await load(); }
    } catch {
      if (mounted.current) setError(t('settings.createCommand.saveFailed'));
    } finally { if (mounted.current) setPending(false); }
  };

  const remove = async (entry: SlashCatalogEntry) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.commands.deleteVaultEntry(entry);
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

  return <>
    <div className="pivi-sp-settings-desc">
      <p className="setting-item-description">{t('settings.slashCommands.desc')}</p>
    </div>
    {error ? <div className="setting-item-description" role="alert">{error}</div> : null}
    <div className="pivi-slash-settings-container">
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
            {entries.map(entry => <div className="pivi-sp-item" key={`${entry.id}:${entry.persistenceKey ?? ''}`}>
              <div className="pivi-sp-info">
                <div className="pivi-sp-item-header">
                  <span className="pivi-sp-item-name">/{entry.name}</span>
                  {entry.argumentHint ? <span className="pivi-slash-item-hint">{entry.argumentHint}</span> : null}
                </div>
                {entry.description ? <div className="pivi-sp-item-desc">{entry.description}</div> : null}
              </div>
              <div className="pivi-sp-item-actions">
                <button className="pivi-settings-action-btn" type="button" aria-label={t('settings.slashCommandsUi.editAria', { name: entry.name })} disabled={pending} onClick={() => { void openModal(entry); }}><ObsidianIcon name="pencil" /></button>
                <button className="pivi-settings-action-btn pivi-settings-delete-btn" type="button" aria-label={t('settings.slashCommandsUi.deleteAria', { name: entry.name })} disabled={pending} onClick={() => setConfirmDelete(entry)}><ObsidianIcon name="trash-2" /></button>
              </div>
            </div>)}
          </div>}
    </div>
    {modalEntry !== undefined
      ? <CommandModal entry={modalEntry ?? undefined} existingIds={existingIds} pending={pending} onClose={() => setModalEntry(undefined)} onSave={(entry, previous) => { void save(entry, previous); }} />
      : null}
    {confirmDelete
      ? <div className="modal-container" role="dialog" aria-modal="true" aria-label={t('settings.slashCommandsUi.deleteConfirm', { name: confirmDelete.name })}>
        <div className="modal-bg" onClick={() => setConfirmDelete(null)} />
        <div className="modal">
          <p>{t('settings.slashCommandsUi.deleteConfirm', { name: confirmDelete.name })}</p>
          <div className="modal-button-container">
            <button type="button" disabled={pending} onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
            <button className="mod-warning" type="button" disabled={pending} onClick={() => { void remove(confirmDelete); }}>{t('common.delete')}</button>
          </div>
        </div>
      </div>
      : null}
  </>;
}
