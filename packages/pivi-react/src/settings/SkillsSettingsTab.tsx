import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts } from '../ports';
import { SettingRow, SettingsListHeader, SettingsPageDescription } from './controls';

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
  const featuredBundle = skills.featuredBundle.getDescriptor();
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
  const installDefault = () => { void run(() => skills.featuredBundle.install()); };
  const updateDefault = () => { void run(() => skills.featuredBundle.update()); };
  const toggleRemote = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const hasDefaultBundle = skills.featuredBundle.isInstalled();

  return (
    <>
      <SettingsPageDescription>
        <p className="pivi-setting-description">{t('settings.skills.intro')}</p>
        <p className="pivi-setting-description">
          {`${t('settings.skills.defaultBundle.label')} `}
          <a href={featuredBundle.sourceUrl}>{featuredBundle.source}</a>
          {`. ${t('settings.skills.defaultBundle.installMore')}`}
        </p>
        <p className="pivi-setting-description">
          {`${t('settings.skills.remote.reviewSkillMd')} `}
          <a href={SKILLS_SH_SECURITY_URL}>{t('settings.skills.remote.securityNotice')}</a>
          .
        </p>
      </SettingsPageDescription>
      <SettingRow name={featuredBundle.name} description={featuredBundle.description}>
        <button type="button" disabled={busy} onClick={hasDefaultBundle ? updateDefault : installDefault}>
          {hasDefaultBundle
            ? t('settings.skills.defaultBundle.updateButton')
            : t('settings.skills.defaultBundle.button')}
        </button>
      </SettingRow>
      <div className="pivi-skills-remote-setting pivi-setting-stack">
        <SettingRow name={t('settings.skills.remote.name')} description={t('settings.skills.remote.desc')}>
          <input
            className="pivi-settings-control"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setRemote([]);
              setSelected(new Set());
            }}
            placeholder={featuredBundle.source}
          />
          <button type="button" disabled={busy || !source.trim()} onClick={listRemote}>{t('settings.skills.remote.listButton')}</button>
        </SettingRow>
      </div>
      {remote.length > 0 ? (
        <div className="pivi-skills-remote-host">
          <SettingsListHeader
            title={t('settings.skills.remote.heading')}
            actions={(
              <button
                type="button"
                className="pivi-settings-text-btn"
                disabled={busy}
                aria-label={t('settings.skills.remote.clearSelected')}
                onClick={() => setSelected(new Set())}
              >
                {t('common.clear')}
              </button>
            )}
          />
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
            className="pivi-button--primary pivi-skills-install-selected-btn"
            disabled={busy}
            onClick={installSelected}
          >
            {t('settings.skills.remote.installSelected')}
          </button>
        </div>
      ) : null}
      <SettingsListHeader
        title={t('settings.skills.installed.heading')}
        actions={(
          <button
            type="button"
            className="pivi-settings-action-btn"
            disabled={busy}
            aria-label={t('settings.skills.installed.updateAll')}
            onClick={() => { void run(() => skills.updateAll()); }}
          >
            <PlatformIcon name="refresh-cw" />
          </button>
        )}
      />
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
                  <PlatformIcon name="refresh-cw" />
                </button>
                <button
                  type="button"
                  className="pivi-settings-action-btn pivi-settings-delete-btn"
                  disabled={busy}
                  aria-label={t('settings.skills.installed.removeAria', { name: skill.name })}
                  onClick={() => { void run(() => skills.remove(skill.folderName)); }}
                >
                  <PlatformIcon name="trash-2" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {notice ? <p className="pivi-setting-description">{notice}</p> : null}
    </>
  );
}
