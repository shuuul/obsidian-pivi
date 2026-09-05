import { Fragment, useRef, useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts, SettingsToolRow } from '../ports';
import { PersistentPermissionsSection } from './PersistentPermissionsSection';
import { Select, SettingRow, SettingsPage, SettingsSection, Toggle } from './primitives';
import type { SettingsUiStore } from './SettingsUiStore';
import { useSettingsUiSnapshot } from './SettingsUiStore';

const READ_SIZE_OPTIONS = [50_000, 100_000, 200_000, 500_000] as const;

const TOOL_GROUPS = [
  ['workspace-api', 'settings.tools.groups.workspace'],
  ['host-cli', 'settings.tools.groups.hostCli'],
  ['pivi', 'settings.tools.groups.pivi'],
  ['additional', 'settings.tools.groups.additional'],
] as const;

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
  const [allowExternalRead, setAllowExternalRead] = useState(settings.allowExternalRead);
  const [defaultReadMaxChars, setDefaultReadMaxChars] = useState(settings.defaultReadMaxChars);
  const [toolRows, setToolRows] = useState(() => ports.complex.tools.listToolRows());
  const [pending, setPending] = useState(false);
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

  const renderExternalReadToggle = () => (
    <SettingRow indented name={t('settings.externalRead.allow.name')} description={t('settings.externalRead.allow.desc')}>
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
  );

  const renderToolConfiguration = (row: SettingsToolRow) => {
    if (row.configuration === 'read') {
      return (
        <>
          <SettingRow
            indented
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
          {renderExternalReadToggle()}
        </>
      );
    }
    if (row.configuration === 'external-read') {
      return renderExternalReadToggle();
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
      <PersistentPermissionsSection ports={ports} />
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
