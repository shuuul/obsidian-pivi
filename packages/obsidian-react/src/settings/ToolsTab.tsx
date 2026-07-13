import {
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools';
import { useState } from 'react';

import { useT } from '../i18n';
import type { SettingsPorts } from '../ports';
import { SettingHeading, SettingRow, Toggle } from './controls';

const TOOL_ROWS = [
  [TOOL_OBSIDIAN_READ, 'tools.display.read', 'tools.display.readDesc'],
  [TOOL_OBSIDIAN_EDIT, 'tools.display.edit', 'tools.display.editDesc'],
  [TOOL_OBSIDIAN_WRITE, 'tools.display.write', 'tools.display.writeDesc'],
  [TOOL_OBSIDIAN_SEARCH, 'tools.display.search', 'tools.display.searchDesc'],
  [TOOL_OBSIDIAN_NOTE_INFO, 'tools.display.noteInfo', 'tools.display.noteInfoDesc'],
  [TOOL_OBSIDIAN_LINKS, 'tools.display.links', 'tools.display.linksDesc'],
  [TOOL_OBSIDIAN_PROPERTIES, 'tools.display.properties', 'tools.display.propertiesDesc'],
  [TOOL_OBSIDIAN_TASKS, 'tools.display.tasks', 'tools.display.tasksDesc', 'cli'],
  [TOOL_OBSIDIAN_HISTORY, 'tools.display.history', 'tools.display.historyDesc', 'cli'],
  [TOOL_OBSIDIAN_DAILY, 'tools.display.daily', 'tools.display.dailyDesc', 'cli'],
  [TOOL_OBSIDIAN_GRAPH, 'tools.display.graph', 'tools.display.graphDesc'],
  [TOOL_OBSIDIAN_TAGS, 'tools.display.tags', 'tools.display.tagsDesc'],
  [TOOL_OBSIDIAN_BASE, 'tools.display.base', 'tools.display.baseDesc'],
  [TOOL_OBSIDIAN_DELETE, 'tools.display.delete', 'tools.display.deleteDesc'],
  [TOOL_OBSIDIAN_MOVE, 'tools.display.move', 'tools.display.moveDesc'],
  [TOOL_OBSIDIAN_LIST, 'tools.display.list', 'tools.display.listDesc'],
  [TOOL_OBSIDIAN_READ_EXTERNAL, 'tools.display.readExternal', 'tools.display.readExternalDesc', 'external'],
  [TOOL_OBSIDIAN_LIST_EXTERNAL, 'tools.display.listExternal', 'tools.display.listExternalDesc', 'external'],
  [TOOL_OBSIDIAN_MKDIR, 'tools.display.mkdir', 'tools.display.mkdirDesc'],
  [TOOL_OBSIDIAN_OPEN, 'tools.display.open', 'tools.display.openDesc'],
  [TOOL_OBSIDIAN_ATTACHMENT, 'tools.display.attachment', 'tools.display.attachmentDesc'],
  [TOOL_OBSIDIAN_GENERATE_IMAGE, 'tools.display.generateImage', 'tools.display.generateImageDesc', 'codex'],
  [TOOL_OBSIDIAN_BASH, 'tools.display.bash', 'tools.display.bashDesc'],
] as const;

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

  return <><div className="pivi-sp-settings-desc"><p className="setting-item-description">{t('settings.tools.intro')}</p></div>{error ? <div className="setting-item-description" role="alert">{error}</div> : null}<SettingHeading>{t('settings.externalRead.heading')}</SettingHeading><SettingRow name={t('settings.externalRead.allow.name')} description={t('settings.externalRead.allow.desc')}><Toggle checked={settings.allowExternalRead} disabled={pending} onChange={(allowExternalRead) => { void save({ allowExternalRead }); }} /></SettingRow><SettingRow name={t('settings.externalRead.directories.name')} description={t('settings.externalRead.directories.desc')}><textarea className="pivi-settings-external-dirs-textarea" rows={4} cols={40} value={directories} placeholder={t('settings.externalRead.directories.placeholder')} disabled={pending} onChange={(event) => setDirectories(event.target.value)} onBlur={() => { void commitDirectories(); }} /><button type="button" title={t('settings.externalRead.directories.browseTooltip')} disabled={pending} onClick={() => { void chooseDirectory(); }}>{t('settings.externalRead.directories.browse')}</button></SettingRow><SettingHeading>{t('settings.bash.heading')}</SettingHeading><SettingRow name={t('settings.bash.allowlist.name')} description={t('settings.bash.allowlist.desc')}><textarea rows={4} cols={40} value={bashAllowlist} disabled={pending} onChange={(event) => setBashAllowlist(event.target.value)} onBlur={commitBashAllowlist} /></SettingRow><SettingHeading>{t('settings.tools.heading')}</SettingHeading>{TOOL_ROWS.map(([name, labelKey, descriptionKey, requirement]) => {
    const unavailable = requirement === 'cli' ? !settings.officialCliEnabled : requirement === 'external' ? !settings.allowExternalRead : requirement === 'codex' ? !ports.complex.models.hasCodexAuth() : false;
    const enabled = !unavailable && (name === TOOL_OBSIDIAN_BASH ? settings.allowBash : !settings.disabledTools.includes(name));
    const description = unavailable ? `${t(descriptionKey)} ${t(requirement === 'cli' ? 'settings.tools.unavailableOfficialCli' : requirement === 'external' ? 'settings.tools.unavailableExternalRead' : 'settings.tools.unavailableCodex')}` : t(descriptionKey);
    return <SettingRow key={name} name={`${t(labelKey)} (${name})`} description={description}><Toggle checked={enabled} disabled={pending || unavailable} onChange={(enabled) => {
      if (name === TOOL_OBSIDIAN_BASH) { void save({ allowBash: enabled }); return; }
      const disabledTools = new Set(settings.disabledTools);
      if (enabled) disabledTools.delete(name); else disabledTools.add(name);
      void save({ disabledTools: [...disabledTools].sort() });
    }} /></SettingRow>;
  })}</>;
}
