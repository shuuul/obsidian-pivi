import {
  classifyBashCommand,
  formatBashPermissionLabel,
  looksLikeLegacyBashEncoding,
  type PersistentBashPermission,
  type PersistentExternalDirectoryPermission,
} from '@pivi/agent/tools';
import { useRef, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsFeedbackMessage, SettingsPorts } from '../ports';
import { BadgeListInput, SettingRow, SettingsSection } from './primitives';

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

  const addBashCommands = async (entries: readonly string[]): Promise<boolean> => {
    setBashFeedback(null);
    return await runOperation(async () => {
      const next = [...bashPermissions];
      let changed = false;
      for (const entry of entries) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (looksLikeLegacyBashEncoding(trimmed)) {
          setBashFeedback({ kind: 'error', message: t('settings.permissions.bash.legacyEncoding') });
          return false;
        }
        const classification = classifyBashCommand(trimmed);
        if (!classification.persistable) {
          const reason = classification.reason === 'unresolved-relative'
            ? t('settings.permissions.bash.unresolvedRelative')
            : classification.reason === 'legacy-encoding'
              ? t('settings.permissions.bash.legacyEncoding')
              : t('settings.permissions.bash.unsafeSyntax');
          setBashFeedback({ kind: 'error', message: reason });
          return false;
        }
        for (const component of classification.components) {
          const permission = { ...component.recommended, enabled: true };
          const existingIndex = next.findIndex(existing => bashIdentityKey(existing) === bashIdentityKey(permission));
          if (existingIndex >= 0) {
            if (!next[existingIndex]!.enabled) {
              next[existingIndex] = permission;
              changed = true;
            }
            continue;
          }
          next.push(permission);
          changed = true;
        }
      }
      if (!changed) return true;
      if (!await persist({ bashPermissions: next })) return false;
      setBashPermissions(next);
      return true;
    }) ?? false;
  };

  const removeBashLabel = async (label: string): Promise<void> => {
    await runOperation(async () => {
      const next = bashPermissions.filter(permission => formatBashPermissionLabel(permission) !== label);
      if (next.length === bashPermissions.length) return;
      if (!await persist({ bashPermissions: next })) return;
      setBashPermissions(next);
    });
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
      for (const path of parsed.directories) {
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setDirectoryFeedback({
            kind: 'error',
            message: t('settings.externalRead.notSaved', { error: validation.error ?? path }),
          });
          return false;
        }
      }
      const next = parsed.directories.map((realpath) => (
        { realpath, enabled: true }
      ));
      if (!await persist({ externalDirectories: next })) return false;
      setExternalDirectories(next);
      return true;
    }) ?? false;
  };

  const removeDirectory = async (realpath: string): Promise<void> => {
    await runOperation(async () => {
      const next = externalDirectories.filter(directory => directory.realpath !== realpath);
      if (next.length === externalDirectories.length) return;
      if (!await persist({ externalDirectories: next })) return;
      setExternalDirectories(next);
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
        <BadgeListInput
          values={bashPermissions.map(formatBashPermissionLabel)}
          inputLabel={t('settings.permissions.bash.inputLabel')}
          removeLabel={(label) => t('settings.permissions.revoke', { label })}
          disabled={pending}
          feedback={bashFeedback}
          onAdd={addBashCommands}
          onRemove={removeBashLabel}
        />
      </SettingRow>
      <SettingRow stacked name={t('settings.permissions.external.name')} description={t('settings.permissions.external.desc')}>
        <BadgeListInput
          values={externalDirectories.map(directory => directory.realpath)}
          placeholder={t('settings.externalRead.directories.placeholder')}
          inputLabel={t('settings.externalRead.directories.inputLabel')}
          removeLabel={(value) => t('settings.permissions.revoke', { label: value })}
          disabled={pending}
          feedback={directoryFeedback}
          onAdd={addDirectories}
          onRemove={removeDirectory}
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
    </SettingsSection>
  );
}
