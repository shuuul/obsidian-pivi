import {
  classifyBashCommand,
  formatBashPermissionLabel,
  type PersistentBashPermission,
  type PersistentExternalDirectoryPermission,
} from '@pivi/agent/tools';
import { useRef, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsFeedbackMessage, SettingsPorts } from '../ports';
import { BadgeListInput, SettingRow, SettingsFeedback, SettingsSection, Toggle } from './primitives';

function parseDirectories(inputs: readonly string[]): { directories: string[]; error?: string } {
  const directories: string[] = [];
  for (const input of inputs) {
    const path = input.trim().replace(/^("|')|("|')$/g, '');
    if (!path) continue;
    if (!/^(?:\/|[A-Za-z]:[\\/])/.test(path)) return { directories: [], error: path };
    const slashed = path.replace(/\\/g, '/');
    const normalized = slashed === '/' || /^[A-Za-z]:\/+$/i.test(slashed)
      ? slashed.replace(/^([A-Za-z]):\/+$/i, '$1:/')
      : slashed.replace(/\/+$/, '');
    if (directories.includes(normalized)) continue;
    if (directories.some((other) => normalized.startsWith(`${other}/`) || other.startsWith(`${normalized}/`))) {
      return { directories: [], error: normalized };
    }
    directories.push(normalized);
  }
  return { directories };
}

function bashIdentityKey(permission: PersistentBashPermission): string {
  const exe = `${permission.executable.kind}:${permission.executable.value}`;
  return permission.kind === 'executable' ? `executable|${exe}` : `subcommand|${exe}|${permission.subcommand}`;
}

export function PersistentPermissionsSection({
  ports,
}: {
  readonly ports: SettingsPorts;
}) {
  const t = useT();
  const settings = ports.complex.tools.getSettings();
  const [bashPermissions, setBashPermissions] = useState<readonly PersistentBashPermission[]>(settings.bashPermissions);
  const [externalDirectories, setExternalDirectories] = useState<readonly PersistentExternalDirectoryPermission[]>(
    settings.externalDirectories,
  );
  const [pending, setPending] = useState(false);
  const [bashFeedback, setBashFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [directoryFeedback, setDirectoryFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const operation = useRef(false);
  const bashInput = useRef<HTMLInputElement>(null);
  const [command, setCommand] = useState('');
  const [editing, setEditing] = useState<PersistentBashPermission | null>(null);
  const [preview, setPreview] = useState<{ scopes: PersistentBashPermission[]; warning: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const persist = async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]): Promise<boolean> => {
    try {
      await ports.complex.tools.saveSettings(patch);
      return true;
    } catch {
      ports.feedback.notify(t('common.error'));
      return false;
    }
  };

  const runOperation = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (operation.current) return null;
    operation.current = true;
    setPending(true);
    try {
      return await action();
    } catch {
      ports.feedback.notify(t('common.error'));
      return null;
    } finally {
      operation.current = false;
      setPending(false);
    }
  };

  const resetBashDraft = () => {
    setCommand('');
    setEditing(null);
    setPreview(null);
    setBashFeedback(null);
  };

  const previewBashCommand = () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    const classification = classifyBashCommand(trimmed);
    if (!classification.persistable) {
      const reason = classification.reason;
      setBashFeedback({
        kind: 'error',
        message: reason === 'unresolved-relative'
          ? t('settings.permissions.bash.unresolvedRelative')
          : reason === 'legacy-encoding'
            ? t('settings.permissions.bash.legacyEncoding')
            : t('settings.permissions.bash.unsafeSyntax'),
      });
      return;
    }
    const scopes = new Map<string, PersistentBashPermission>();
    for (const component of classification.components) {
      const permission = { ...component.recommended, enabled: editing?.enabled ?? true };
      scopes.set(bashIdentityKey(permission), permission);
    }
    setBashFeedback(null);
    setPreview({
      scopes: [...scopes.values()],
      warning: classification.components.some(component => component.risk !== 'none'),
    });
  };

  const saveBashPermissions = async (next: readonly PersistentBashPermission[]) => runOperation(async () => {
    if (!await persist({ bashPermissions: [...next] })) return false;
    setBashPermissions(next);
    return true;
  });

  const saveBashPreview = async () => {
    if (!preview) return;
    const next = new Map(bashPermissions.map(permission => [bashIdentityKey(permission), permission]));
    if (editing) next.delete(bashIdentityKey(editing));
    for (const permission of preview.scopes) {
      const key = bashIdentityKey(permission);
      if (!editing || !next.has(key)) next.set(key, permission);
    }
    if (await saveBashPermissions([...next.values()])) resetBashDraft();
  };

  const addDirectories = async (entries: readonly string[]): Promise<boolean> => {
    setDirectoryFeedback(null);
    return await runOperation(async () => {
      const existing = externalDirectories.map(directory => directory.realpath);
      const parsed = parseDirectories([...existing, ...entries]);
      if (parsed.error) {
        setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.notSaved', {
          error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }),
        }) });
        return false;
      }
      const added = parseDirectories(entries).directories;
      for (const path of added) {
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setDirectoryFeedback({
            kind: 'error',
            message: t('settings.externalRead.notSaved', { error: validation.error ?? path }),
          });
          return false;
        }
      }
      const next = parsed.directories.map((realpath) => ({
        realpath,
        enabled: added.includes(realpath) || (externalDirectories.find(directory => directory.realpath === realpath)?.enabled ?? true),
      }));
      if (!await persist({ externalDirectories: next })) return false;
      setExternalDirectories(next);
      return true;
    }) ?? false;
  };

  const saveDirectories = async (next: readonly PersistentExternalDirectoryPermission[]) => {
    await runOperation(async () => {
      if (await persist({ externalDirectories: [...next] })) setExternalDirectories(next);
    });
  };

  const clearPermissions = async () => {
    await runOperation(async () => {
      if (!await persist({ bashPermissions: [], externalDirectories: [] })) return;
      setBashPermissions([]);
      setExternalDirectories([]);
      setConfirmClear(false);
      resetBashDraft();
    });
  };

  const chooseDirectory = async () => {
    setDirectoryFeedback(null);
    try {
      const path = await ports.complex.tools.chooseExternalDirectory(
        externalDirectories.map(directory => directory.realpath).join('\n'),
      );
      if (!path) return;
      await addDirectories([path]);
    } catch {
      setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.directories.pickerFailed') });
    }
  };

  return (
    <SettingsSection title={t('settings.permissions.heading')}>
      <p className="pivi-setting-description">{t('settings.permissions.intro')}</p>
      <SettingRow stacked name={t('settings.permissions.bash.name')} description={t('settings.permissions.bash.desc')}>
        {bashPermissions.length > 0 && (
          <div className="pivi-settings-permission-list">
            {bashPermissions.map(permission => {
              const label = formatBashPermissionLabel(permission);
              return (
                <SettingRow key={bashIdentityKey(permission)} name={label}
                  description={t(permission.enabled ? 'settings.permissions.enabled' : 'settings.permissions.disabled')}>
                  <button type="button" aria-label={t('settings.permissions.editScopeFor', { label })} disabled={pending} onClick={() => {
                    resetBashDraft();
                    setEditing(permission);
                    bashInput.current?.focus();
                  }}>
                    {t('settings.permissions.editScope')}
                  </button>
                  <button type="button" aria-label={t('settings.permissions.revoke', { label })} disabled={pending} onClick={() => {
                    if (editing === permission) resetBashDraft();
                    void saveBashPermissions(bashPermissions.filter(item => item !== permission));
                  }}>
                    {t('settings.permissions.revokeAction')}
                  </button>
                  <Toggle checked={permission.enabled} disabled={pending} label={t('settings.permissions.enabledFor', { label })} onChange={(enabled) => {
                    if (editing === permission) resetBashDraft();
                    void saveBashPermissions(bashPermissions.map(item => item === permission ? { ...item, enabled } : item));
                  }} />
                </SettingRow>
              );
            })}
          </div>
        )}
        {editing && <span>{t('settings.permissions.replaceScope', { label: formatBashPermissionLabel(editing) })}</span>}
        <input
          ref={bashInput}
          className="pivi-settings-control"
          aria-label={editing
            ? t('settings.permissions.replaceScope', { label: formatBashPermissionLabel(editing) })
            : t('settings.permissions.bash.inputLabel')}
          disabled={pending}
          value={command}
          onChange={(event) => {
            setCommand(event.target.value);
            setPreview(null);
            setBashFeedback(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            previewBashCommand();
          }}
        />
        <button type="button" disabled={pending || !command.trim()} onClick={previewBashCommand}>
          {t('settings.permissions.previewScope')}
        </button>
        <SettingsFeedback feedback={bashFeedback} />
        {preview && (
          <>
            <div role="status">
              {t('settings.permissions.previewResult', { scopes: preview.scopes.map(formatBashPermissionLabel).join(', ') })}
              {preview.warning && <p>{t('settings.permissions.riskWarning')}</p>}
              {editing?.kind === 'subcommand' && preview.scopes.some(scope => scope.kind === 'executable'
                && scope.executable.kind === editing.executable.kind && scope.executable.value === editing.executable.value)
                && <p>{t('chat.capabilityApproval.broaderWarning')}</p>}
            </div>
            <button type="button" disabled={pending} onClick={() => { void saveBashPreview(); }}>{t('common.save')}</button>
          </>
        )}
        {(editing || preview) && <button type="button" disabled={pending} onClick={resetBashDraft}>{t('common.cancel')}</button>}
      </SettingRow>
      <SettingRow stacked name={t('settings.permissions.external.name')} description={t('settings.permissions.external.desc')}>
        {externalDirectories.length > 0 && (
          <div className="pivi-settings-permission-list">
            {externalDirectories.map(directory => {
              const label = directory.realpath;
              return (
                <SettingRow key={label} name={label}
                  description={t(directory.enabled ? 'settings.permissions.enabled' : 'settings.permissions.disabled')}>
                  <button type="button" aria-label={t('settings.permissions.revoke', { label })} disabled={pending} onClick={() => {
                    void saveDirectories(externalDirectories.filter(item => item !== directory));
                  }}>
                    {t('settings.permissions.revokeAction')}
                  </button>
                  <Toggle checked={directory.enabled} disabled={pending} label={t('settings.permissions.enabledFor', { label })} onChange={(enabled) => {
                    void saveDirectories(externalDirectories.map(item => item === directory ? { ...item, enabled } : item));
                  }} />
                </SettingRow>
              );
            })}
          </div>
        )}
        <BadgeListInput
          placeholder={t('settings.externalRead.directories.placeholder')}
          inputLabel={t('settings.externalRead.directories.inputLabel')}
          disabled={pending}
          feedback={directoryFeedback}
          onAdd={addDirectories}
        />
        <button
          type="button"
          title={t('settings.externalRead.directories.browseTooltip')}
          disabled={pending}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { void chooseDirectory(); }}
        >
          {t('settings.externalRead.directories.browse')}
        </button>
      </SettingRow>
      <SettingRow name={t('settings.permissions.clearAll')}>
        {confirmClear ? (
          <>
            <button type="button" disabled={pending} onClick={() => { void clearPermissions(); }}>
              {t('settings.permissions.confirmClear')}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button>
          </>
        ) : (
          <button type="button" disabled={pending || bashPermissions.length + externalDirectories.length === 0} onClick={() => setConfirmClear(true)}>
            {t('common.clear')}
          </button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}
