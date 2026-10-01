/** Command pickers used when adding an editor selection toolbar shortcut. */

import type { EditorCommandId } from '@pivi/agent/settings/types';
import { EDITOR_COMMANDS } from '@pivi/agent/settings/types';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type {
  SettingsEditorToolbarCommandEntry,
  SettingsEditorToolbarPiviCommandEntry,
  SettingsEditorToolbarPort,
} from '../ports';
import { Select } from './primitives';

export function EditorCommandPicker({
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

export function ObsidianCommandPicker({
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

export function PiviCommandPicker({
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
