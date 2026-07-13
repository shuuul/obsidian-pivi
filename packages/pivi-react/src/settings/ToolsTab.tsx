import { useState } from 'react';

import { useT } from '../i18n';
import type { SettingsPorts } from '../ports';
import { SettingHeading, SettingRow, Toggle } from './controls';

function parseDirectories(value: string): { directories: string[]; error?: string } {
  const directories: string[] = [];
  for (const input of value.split(/\r?\n/)) {
    const path = input.trim().replace(/^("|')|("|')$/g, '');
    if (!path) continue;
    if (!/^\/(?:.|\n)*|^[A-Za-z]:[\\/]/.test(path)) return { directories: [], error: path };
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    if (directories.includes(normalized)) continue;
    if (directories.some((other) => normalized.startsWith(`${other}/`) || other.startsWith(`${normalized}/`))) return { directories: [], error: normalized };
    directories.push(normalized);
  }
  return { directories };
}

export function ToolsTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const settings = ports.complex.tools.getSettings();
  const [directories, setDirectories] = useState(settings.externalReadDirectories.join('\n'));
  const [bashAllowlist, setBashAllowlist] = useState(settings.bashAllowlist.join('\n'));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Parameters<SettingsPorts['complex']['tools']['saveSettings']>[0]) => {
    setPending(true);
    setError(null);
    try {
      await ports.complex.tools.saveSettings(patch);
    } catch {
      setError(t('common.error'));
    } finally { setPending(false); }
  };
  const commitDirectories = async () => {
    const parsed = parseDirectories(directories);
    if (parsed.error) { setError(t('settings.externalRead.notSaved', { error: t('settings.externalRead.pathMustBeAbsolute', { path: parsed.error }) })); setDirectories(settings.externalReadDirectories.join('\n')); return; }
    for (const path of parsed.directories) {
      const validation = await ports.complex.tools.validateExternalDirectory(path);
      if (!validation.valid) { setError(t('settings.externalRead.notSaved', { error: validation.error ?? path })); setDirectories(settings.externalReadDirectories.join('\n')); return; }
    }
    await save({ externalReadDirectories: parsed.directories });
  };
  const chooseDirectory = async () => {
    setPending(true);
    setError(null);
    try {
      const path = await ports.complex.tools.chooseExternalDirectory(directories);
      if (!path) return;
      const parsed = parseDirectories([...directories.split(/\r?\n/), path].join('\n'));
      if (parsed.error) { setError(t('settings.externalRead.notSaved', { error: parsed.error })); return; }
      const validation = await ports.complex.tools.validateExternalDirectory(path);
      if (!validation.valid) { setError(t('settings.externalRead.notSaved', { error: validation.error ?? path })); return; }
      setDirectories(parsed.directories.join('\n'));
      await ports.complex.tools.saveSettings({ externalReadDirectories: parsed.directories });
    } catch {
      setError(t('settings.externalRead.directories.pickerFailed'));
    } finally { setPending(false); }
  };
  const commitBashAllowlist = () => {
    const allowlist = [...new Set(bashAllowlist.split(/\r?\n/).map((command) => command.trim()).filter(Boolean))];
    if (allowlist.join('\n') !== settings.bashAllowlist.join('\n')) void save({ bashAllowlist: allowlist });
  };

  return <><div className="pivi-sp-settings-desc"><p className="setting-item-description">{t('settings.tools.intro')}</p></div>{error ? <div className="setting-item-description" role="alert">{error}</div> : null}<SettingHeading>{t('settings.externalRead.heading')}</SettingHeading><SettingRow name={t('settings.externalRead.allow.name')} description={t('settings.externalRead.allow.desc')}><Toggle checked={settings.allowExternalRead} disabled={pending} onChange={(allowExternalRead) => { void save({ allowExternalRead }); }} /></SettingRow><SettingRow name={t('settings.externalRead.directories.name')} description={t('settings.externalRead.directories.desc')}><textarea className="pivi-settings-external-dirs-textarea" rows={4} cols={40} value={directories} placeholder={t('settings.externalRead.directories.placeholder')} disabled={pending} onChange={(event) => setDirectories(event.target.value)} onBlur={() => { void commitDirectories(); }} /><button type="button" title={t('settings.externalRead.directories.browseTooltip')} disabled={pending} onClick={() => { void chooseDirectory(); }}>{t('settings.externalRead.directories.browse')}</button></SettingRow><SettingHeading>{t('settings.bash.heading')}</SettingHeading><SettingRow name={t('settings.bash.allowlist.name')} description={t('settings.bash.allowlist.desc')}><textarea rows={4} cols={40} value={bashAllowlist} disabled={pending} onChange={(event) => setBashAllowlist(event.target.value)} onBlur={commitBashAllowlist} /></SettingRow><SettingHeading>{t('settings.tools.heading')}</SettingHeading>{ports.complex.tools.listToolRows().map((row) => {
    return <SettingRow key={row.name} name={`${row.label} (${row.name})`} description={row.description}><Toggle checked={row.enabled} disabled={pending || !row.available} onChange={(enabled) => {
      void ports.complex.tools.setToolEnabled(row.name, enabled);
    }} /></SettingRow>;
  })}</>;
}
