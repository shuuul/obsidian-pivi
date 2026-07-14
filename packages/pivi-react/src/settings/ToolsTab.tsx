import { useRef, useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts } from '../ports';
import { BadgeListInput, SettingHeading, SettingRow, SettingsPageDescription, Toggle } from './controls';

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

export function ToolsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { hostName } = useHostTerminology();
  const settings = ports.complex.tools.getSettings();
  const [directories, setDirectories] = useState<readonly string[]>(settings.externalReadDirectories);
  const [bashAllowlist, setBashAllowlist] = useState<readonly string[]>(settings.bashAllowlist);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);

  const persist = async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]): Promise<boolean> => {
    try {
      await ports.complex.tools.saveSettings(patch);
      return true;
    } catch {
      setError(t('common.error'));
      return false;
    }
  };

  const runOperation = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (operation.current) return null;
    operation.current = true;
    setPending(true);
    setError(null);
    try {
      return await action();
    } catch {
      setError(t('common.error'));
      return null;
    } finally {
      operation.current = false;
      setPending(false);
    }
  };

  const addDirectories = async (entries: readonly string[]): Promise<boolean> => {
    return await runOperation(async () => {
      const parsed = parseDirectories([...directories, ...entries]);
      if (parsed.error) {
        setError(t('settings.externalRead.notSaved', {
          error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }),
        }));
        return false;
      }
      if (parsed.directories.length === directories.length) return true;
      for (const path of parsed.directories) {
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setError(t('settings.externalRead.notSaved', { error: validation.error ?? path }));
          return false;
        }
      }
      if (!await persist({ externalReadDirectories: parsed.directories })) return false;
      setDirectories(parsed.directories);
      return true;
    }) ?? false;
  };

  const removeDirectory = async (path: string) => {
    await runOperation(async () => {
      const next = directories.filter(directory => directory !== path);
      if (await persist({ externalReadDirectories: next })) setDirectories(next);
    });
  };

  const chooseDirectory = async () => {
    await runOperation(async () => {
      try {
        const path = await ports.complex.tools.chooseExternalDirectory(directories.join('\n'));
        if (!path) return;
        const parsed = parseDirectories([...directories, path]);
        if (parsed.error) {
          setError(t('settings.externalRead.notSaved', {
            error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }),
          }));
          return;
        }
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setError(t('settings.externalRead.notSaved', { error: validation.error ?? path }));
          return;
        }
        if (await persist({ externalReadDirectories: parsed.directories })) setDirectories(parsed.directories);
      } catch {
        setError(t('settings.externalRead.directories.pickerFailed'));
      }
    });
  };

  const addBashCommands = async (entries: readonly string[]): Promise<boolean> => {
    return await runOperation(async () => {
      const next = [...new Set([...bashAllowlist, ...entries.map(command => command.trim()).filter(Boolean)])];
      if (next.length === bashAllowlist.length) return true;
      if (!await persist({ bashAllowlist: next })) return false;
      setBashAllowlist(next);
      return true;
    }) ?? false;
  };

  const removeBashCommand = async (command: string) => {
    await runOperation(async () => {
      const next = bashAllowlist.filter(entry => entry !== command);
      if (await persist({ bashAllowlist: next })) setBashAllowlist(next);
    });
  };

  return (
    <>
      <SettingsPageDescription>
        <p className="pivi-setting-description">{t('settings.tools.intro', { hostName })}</p>
      </SettingsPageDescription>
      {error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}
      <SettingHeading>{t('settings.externalRead.heading')}</SettingHeading>
      <SettingRow name={t('settings.externalRead.allow.name')} description={t('settings.externalRead.allow.desc')}>
        <Toggle checked={settings.allowExternalRead} disabled={pending} label={t('settings.externalRead.allow.name')} onChange={(allowExternalRead) => { void runOperation(() => persist({ allowExternalRead })); }} />
      </SettingRow>
      <div className="pivi-external-directories-setting pivi-setting-stack">
        <SettingRow name={t('settings.externalRead.directories.name')} description={t('settings.externalRead.directories.desc')}>
          <BadgeListInput
            values={directories}
            placeholder={t('settings.externalRead.directories.placeholder')}
            inputLabel={t('settings.externalRead.directories.inputLabel')}
            removeLabel={(value) => t('settings.externalRead.directories.removeAria', { value })}
            disabled={pending}
            onAdd={addDirectories}
            onRemove={removeDirectory}
          />
          <button type="button" title={t('settings.externalRead.directories.browseTooltip')} disabled={pending} onMouseDown={(event) => event.preventDefault()} onClick={() => { void chooseDirectory(); }}>
            {t('settings.externalRead.directories.browse')}
          </button>
        </SettingRow>
      </div>
      <SettingHeading>{t('settings.bash.heading')}</SettingHeading>
      <div className="pivi-setting-stack">
        <SettingRow name={t('settings.bash.allowlist.name')} description={t('settings.bash.allowlist.desc')}>
          <BadgeListInput
            values={bashAllowlist}
            inputLabel={t('settings.bash.allowlist.inputLabel')}
            removeLabel={(value) => t('settings.bash.allowlist.removeAria', { value })}
            disabled={pending}
            onAdd={addBashCommands}
            onRemove={removeBashCommand}
          />
        </SettingRow>
      </div>
      <SettingHeading>{t('settings.tools.heading')}</SettingHeading>
      {ports.complex.tools.listToolRows().map((row) => (
        <SettingRow key={row.name} name={`${row.label} (${row.name})`} description={row.description}>
          <Toggle
            checked={row.enabled}
            disabled={pending || !row.available}
            label={row.label}
            onChange={(enabled) => { void ports.complex.tools.setToolEnabled(row.name, enabled); }}
          />
        </SettingRow>
      ))}
    </>
  );
}
