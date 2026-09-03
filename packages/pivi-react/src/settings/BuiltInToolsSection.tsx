import { Fragment, useRef, useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsFeedbackMessage, SettingsPorts, SettingsToolRow } from '../ports';
import { BadgeListInput, Select, SettingRow, SettingsPage, SettingsSection, Toggle } from './controls';
import type { SettingsUiStore } from './SettingsUiStore';
import { useSettingsUiSnapshot } from './SettingsUiStore';

const READ_SIZE_OPTIONS = [50_000, 100_000, 200_000, 500_000] as const;

const TOOL_GROUPS = [
  ['workspace-api', 'settings.tools.groups.workspace'],
  ['host-cli', 'settings.tools.groups.hostCli'],
  ['pivi', 'settings.tools.groups.pivi'],
  ['additional', 'settings.tools.groups.additional'],
] as const;

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

export function BuiltInToolsSection({
  ports,
  store,
}: {
  readonly ports: SettingsPorts;
  readonly store: SettingsUiStore;
}) {
  const t = useT();
  const { hostName, workspaceNameTitle } = useHostTerminology();
  const { subagents } = useSettingsUiSnapshot(store);
  const settings = ports.complex.tools.getSettings();
  const [directories, setDirectories] = useState<readonly string[]>(settings.externalReadDirectories);
  const [bashAllowlist, setBashAllowlist] = useState<readonly string[]>(settings.bashAllowlist);
  const [allowExternalRead, setAllowExternalRead] = useState(settings.allowExternalRead);
  const [defaultReadMaxChars, setDefaultReadMaxChars] = useState(settings.defaultReadMaxChars);
  const [toolRows, setToolRows] = useState(() => ports.complex.tools.listToolRows());
  const [pending, setPending] = useState(false);
  const [directoryFeedback, setDirectoryFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const operation = useRef(false);
  const pendingTools = useRef(new Set<string>());

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

  const saveSubagents = (patch: Parameters<SettingsUiStore['updateSubagents']>[0]): void => {
    const previous = store.getSnapshot().subagents;
    store.updateSubagents(patch);
    void ports.actions.saveSubagents(patch).catch((cause: unknown) => {
      store.updateSubagents(previous);
      ports.feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const addDirectories = async (entries: readonly string[]): Promise<boolean> => {
    setDirectoryFeedback(null);
    return await runOperation(async () => {
      const parsed = parseDirectories([...directories, ...entries]);
      if (parsed.error) {
        setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.notSaved', {
          error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }),
        }) });
        return false;
      }
      if (parsed.directories.length === directories.length) return true;
      for (const path of parsed.directories) {
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.notSaved', { error: validation.error ?? path }) });
          return false;
        }
      }
      if (!await persist({ externalReadDirectories: parsed.directories })) return false;
      setDirectories(parsed.directories);
      return true;
    }) ?? false;
  };

  const removeDirectory = async (path: string) => {
    setDirectoryFeedback(null);
    await runOperation(async () => {
      const next = directories.filter(directory => directory !== path);
      if (await persist({ externalReadDirectories: next })) setDirectories(next);
    });
  };

  const chooseDirectory = async () => {
    setDirectoryFeedback(null);
    await runOperation(async () => {
      try {
        const path = await ports.complex.tools.chooseExternalDirectory(directories.join('\n'));
        if (!path) return;
        const parsed = parseDirectories([...directories, path]);
        if (parsed.error) {
          setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.notSaved', {
            error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }),
          }) });
          return;
        }
        const validation = await ports.complex.tools.validateExternalDirectory(path);
        if (!validation.valid) {
          setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.notSaved', { error: validation.error ?? path }) });
          return;
        }
        if (await persist({ externalReadDirectories: parsed.directories })) setDirectories(parsed.directories);
      } catch {
        setDirectoryFeedback({ kind: 'error', message: t('settings.externalRead.directories.pickerFailed') });
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

  const renderToolConfiguration = (row: SettingsToolRow) => {
    if (row.configuration === 'read') {
      return (
        <SettingRow
          name={t('settings.tools.reading.defaultSize.name')}
          description={t('settings.tools.reading.defaultSize.desc')}
        >
          <Select
            disabled={pending}
            label={t('settings.tools.reading.defaultSize.name')}
            value={String(defaultReadMaxChars)}
            onChange={(value) => {
              const next = Number(value);
              void runOperation(async () => {
                if (!await persist({ defaultReadMaxChars: next })) return;
                setDefaultReadMaxChars(next);
              });
            }}
          >
            {READ_SIZE_OPTIONS.map((value) => (
              <option key={value} value={value}>{t('settings.tools.reading.defaultSize.option', { count: value / 1_000 })}</option>
            ))}
          </Select>
        </SettingRow>
      );
    }
    if (row.configuration === 'external-read') {
      return (
        <>
          <SettingRow name={t('settings.externalRead.allow.name')} description={t('settings.externalRead.allow.desc')}>
            <Toggle
              checked={allowExternalRead}
              disabled={pending}
              label={t('settings.externalRead.allow.name')}
              onChange={(next) => {
                void runOperation(async () => {
                  if (!await persist({ allowExternalRead: next })) return;
                  setAllowExternalRead(next);
                  setToolRows(ports.complex.tools.listToolRows());
                });
              }}
            />
          </SettingRow>
          <SettingRow
            stacked
            name={t('settings.externalRead.directories.name')}
            description={t('settings.externalRead.directories.desc')}
          >
            <BadgeListInput
              values={directories}
              placeholder={t('settings.externalRead.directories.placeholder')}
              inputLabel={t('settings.externalRead.directories.inputLabel')}
              removeLabel={(value) => t('settings.externalRead.directories.removeAria', { value })}
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
        </>
      );
    }
    if (row.configuration === 'bash') {
      return (
        <SettingRow stacked name={t('settings.bash.allowlist.name')} description={t('settings.bash.allowlist.desc')}>
          <BadgeListInput
            values={bashAllowlist}
            inputLabel={t('settings.bash.allowlist.inputLabel')}
            removeLabel={(value) => t('settings.bash.allowlist.removeAria', { value })}
            disabled={pending}
            onAdd={addBashCommands}
            onRemove={removeBashCommand}
          />
        </SettingRow>
      );
    }
    return null;
  };

  return (
    <SettingsPage description={<p>{t('settings.tools.intro', { hostName })}</p>}>
      {TOOL_GROUPS.map(([group, titleKey]) => {
        const rows = toolRows.filter(row => row.group === group);
        if (rows.length === 0) return null;
        return (
          <SettingsSection key={group} title={t(titleKey, { hostName, workspaceNameTitle })}>
            {rows.map((row) => (
              <Fragment key={row.name}>
                <SettingRow name={`${row.label} (${row.name})`} description={row.description}>
                  <Toggle
                    checked={row.enabled}
                    disabled={!row.available}
                    label={row.label}
                    onChange={(enabled) => {
                      if (pendingTools.current.has(row.name)) return;
                      pendingTools.current.add(row.name);
                      setToolRows(current => current.map(entry => (
                        entry.name === row.name ? { ...entry, enabled } : entry
                      )));
                      void ports.complex.tools.setToolEnabled(row.name, enabled)
                        .catch(() => {
                          setToolRows(current => current.map(entry => (
                            entry.name === row.name ? { ...entry, enabled: !enabled } : entry
                          )));
                          ports.feedback.notify(t('common.error'));
                        })
                        .finally(() => {
                          pendingTools.current.delete(row.name);
                        });
                    }}
                  />
                </SettingRow>
                {row.configuration ? renderToolConfiguration(row) : null}
              </Fragment>
            ))}
          </SettingsSection>
        );
      })}
      <SettingsSection title={t('settings.subagents.heading')}>
        <SettingRow name={t('settings.subagents.enableSpawn.name')} description={t('settings.subagents.enableSpawn.desc')}>
          <Toggle checked={subagents.enabled} label={t('settings.subagents.enableSpawn.name')} onChange={(enabled) => saveSubagents({ enabled })} />
        </SettingRow>
        <SettingRow name={t('settings.subagents.allowBackground.name')} description={t('settings.subagents.allowBackground.desc')}>
          <Toggle checked={subagents.allowBackground} label={t('settings.subagents.allowBackground.name')} onChange={(allowBackground) => saveSubagents({ allowBackground })} />
        </SettingRow>
        <SettingRow name={t('settings.subagents.maxConcurrent.name')} description={t('settings.subagents.maxConcurrent.desc')}>
          <Select
            label={t('settings.subagents.maxConcurrent.name')}
            value={String(subagents.maxConcurrentSubagents)}
            onChange={(value) => saveSubagents({ maxConcurrentSubagents: Number(value) as typeof subagents.maxConcurrentSubagents })}
          >
            {[1, 2, 3, 4, 8].map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}
