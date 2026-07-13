import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  isDefaultVaultSkillFolder,
} from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { ObsidianIcon } from '../icons';
import type { SettingsComplexPorts } from '../ports';
import { SettingRow } from './controls';

type Skill = SettingsComplexPorts['skills']['list'] extends () => readonly (infer Entry)[] ? Entry : never;
type RemoteSkill = { readonly name: string; readonly description: string };

const SKILLS_SH_SECURITY_URL = 'https://skills.sh/docs/security';

export function SkillsSettingsTab({ skills }: { readonly skills: SettingsComplexPorts['skills'] }) {
  const t = useT();
  const mounted = useRef(true);
  const [entries, setEntries] = useState<readonly Skill[]>(() => skills.list());
  const [source, setSource] = useState('');
  const [remote, setRemote] = useState<readonly RemoteSkill[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);
  const refresh = () => { if (mounted.current) setEntries(skills.list()); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      refresh();
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : t('common.error'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const listRemote = () => {
    void run(async () => {
      const listed = await skills.listRemote(source);
      if (mounted.current) {
        setRemote(listed);
        setSelected(new Set());
        setNotice(listed.length === 0 ? t('settings.skills.notices.noRemote') : null);
      }
    });
  };
  const installSelected = () => {
    if (selected.size === 0) {
      setNotice(t('settings.skills.notices.selectOne'));
      return;
    }
    void run(async () => {
      await skills.install(source, [...selected]);
      if (mounted.current) {
        setRemote([]);
        setSelected(new Set());
      }
    });
  };
  const installDefault = () => { void run(() => skills.install(t('settings.skills.defaultBundle.slug'))); };
  const toggleRemote = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const hasDefaultBundle = entries.some((skill) => isDefaultVaultSkillFolder(skill.folderName));

  return (
    <>
      <div className="pivi-sp-settings-desc">
        <p className="setting-item-description">{t('settings.skills.intro')}</p>
        <p className="setting-item-description">
          {`${t('settings.skills.defaultBundle.label')} `}
          <a href={DEFAULT_VAULT_SKILLS_REPO_URL}>{t('settings.skills.defaultBundle.slug')}</a>
          {`. ${t('settings.skills.defaultBundle.installMore')}`}
        </p>
        <p className="setting-item-description">
          {`${t('settings.skills.remote.reviewSkillMd')} `}
          <a href={SKILLS_SH_SECURITY_URL}>{t('settings.skills.remote.securityNotice')}</a>
          .
        </p>
      </div>
      {!hasDefaultBundle ? (
        <SettingRow name={t('settings.skills.defaultBundle.name')} description={t('settings.skills.defaultBundle.desc')}>
          <button type="button" disabled={busy} onClick={installDefault}>{t('settings.skills.defaultBundle.button')}</button>
        </SettingRow>
      ) : null}
      <SettingRow name={t('settings.skills.remote.name')} description={t('settings.skills.remote.desc')}>
        <input
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setRemote([]);
            setSelected(new Set());
          }}
          placeholder={t('settings.skills.defaultBundle.slug')}
        />
        <button type="button" disabled={busy || !source.trim()} onClick={listRemote}>{t('settings.skills.remote.listButton')}</button>
      </SettingRow>
      {remote.length > 0 ? (
        <div className="pivi-skills-remote-host">
          <div className="pivi-sp-header">
            <span className="pivi-sp-label">{t('settings.skills.remote.heading')}</span>
            <div className="pivi-sp-header-actions">
              <button
                type="button"
                className="pivi-settings-text-btn"
                disabled={busy}
                aria-label={t('settings.skills.remote.clearSelected')}
                onClick={() => setSelected(new Set())}
              >
                {t('common.clear')}
              </button>
            </div>
          </div>
          <div className="pivi-sp-list pivi-skills-remote-list">
            {remote.map((skill) => (
              <label className="pivi-skill-choice" key={skill.name}>
                <input
                  type="checkbox"
                  className="pivi-skill-choice-checkbox"
                  checked={selected.has(skill.name)}
                  aria-label={t('settings.skills.installed.installAria', { name: skill.name })}
                  onChange={() => toggleRemote(skill.name)}
                />
                <span className="pivi-skill-choice-info">
                  <span className="pivi-sp-item-name">{skill.name}</span>
                  {skill.description ? <span className="pivi-sp-item-desc">{skill.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="mod-cta pivi-skills-install-selected-btn"
            disabled={busy}
            onClick={installSelected}
          >
            {t('settings.skills.remote.installSelected')}
          </button>
        </div>
      ) : null}
      <div className="pivi-sp-header">
        <span className="pivi-sp-label">{t('settings.skills.installed.heading')}</span>
        <div className="pivi-sp-header-actions">
          <button
            type="button"
            className="pivi-settings-action-btn"
            disabled={busy}
            aria-label={t('settings.skills.installed.updateAll')}
            onClick={() => { void run(() => skills.updateAll()); }}
          >
            <ObsidianIcon name="refresh-cw" />
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="pivi-sp-empty-state">{t('settings.skills.installed.empty')}</p>
      ) : (
        <div className="pivi-sp-list">
          {entries.map((skill) => (
            <div className="pivi-sp-item" key={skill.folderName}>
              <div className="pivi-sp-info">
                <div className="pivi-sp-item-header">
                  <span className="pivi-sp-item-name">{skill.name}</span>
                  <span className="pivi-sp-item-folder">{skill.folderName}</span>
                  {skill.disabled ? <span className="pivi-slash-item-badge">{t('common.disabled')}</span> : null}
                </div>
                {skill.description ? <div className="pivi-sp-item-desc">{skill.description}</div> : null}
              </div>
              <div className="pivi-sp-item-actions">
                <button
                  type="button"
                  className="pivi-settings-text-btn"
                  disabled={busy}
                  aria-label={skill.disabled
                    ? t('settings.skills.installed.enableAria', { name: skill.name })
                    : t('settings.skills.installed.disableAria', { name: skill.name })}
                  onClick={() => { void run(() => skills.setDisabled(skill.folderName, !skill.disabled)); }}
                >
                  {skill.disabled ? t('common.enable') : t('common.disable')}
                </button>
                <button
                  type="button"
                  className="pivi-settings-action-btn"
                  disabled={busy}
                  aria-label={t('settings.skills.installed.updateAria', { name: skill.name })}
                  onClick={() => { void run(() => skills.update(skill.name, skill.folderName)); }}
                >
                  <ObsidianIcon name="refresh-cw" />
                </button>
                <button
                  type="button"
                  className="pivi-settings-action-btn pivi-settings-delete-btn"
                  disabled={busy}
                  aria-label={t('settings.skills.installed.removeAria', { name: skill.name })}
                  onClick={() => { void run(() => skills.remove(skill.folderName)); }}
                >
                  <ObsidianIcon name="trash-2" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {notice ? <p className="setting-item-description">{notice}</p> : null}
    </>
  );
}
