import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts, SettingsFeedbackMessage, SettingsFeedbackPort } from '../ports';
import {
  SettingRow,
  SettingsCollection,
  SettingsFeedback,
  SettingsInlineActions,
  SettingsPage,
  SettingsRemoveButton,
  SettingsSection,
  Toggle,
} from './primitives';

type Skill = SettingsComplexPorts['skills']['list'] extends () => readonly (infer Entry)[] ? Entry : never;
type RemoteSkill = { readonly name: string; readonly description: string };

type SkillPendingOperation =
  | { readonly kind: 'installBundle' }
  | { readonly kind: 'updateBundle' }
  | { readonly kind: 'listRemote' }
  | { readonly kind: 'installSelected' }
  | { readonly kind: 'updateAll' }
  | { readonly kind: 'update'; readonly name: string }
  | { readonly kind: 'remove'; readonly name: string; readonly folderName: string }
  | { readonly kind: 'enable'; readonly name: string }
  | { readonly kind: 'disable'; readonly name: string };

const SKILLS_SH_SECURITY_URL = 'https://skills.sh/docs/security';

export function SkillsSettingsTab({ skills, feedback }: {
  readonly skills: SettingsComplexPorts['skills'];
  readonly feedback: SettingsFeedbackPort;
}) {
  const t = useT();
  const mounted = useRef(true);
  const [entries, setEntries] = useState<readonly Skill[]>(() => skills.list());
  const [source, setSource] = useState('');
  const [remote, setRemote] = useState<readonly RemoteSkill[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const featuredBundle = skills.featuredBundle.getDescriptor();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = () => { if (mounted.current) setEntries(skills.list()); };

  const pendingMessage = (operation: SkillPendingOperation): string => {
    switch (operation.kind) {
      case 'installBundle':
        return t('settings.skills.feedback.pending.installBundle');
      case 'updateBundle':
        return t('settings.skills.feedback.pending.updateBundle');
      case 'listRemote':
        return t('settings.skills.feedback.pending.listRemote');
      case 'installSelected':
        return t('settings.skills.feedback.pending.installSelected');
      case 'updateAll':
        return t('settings.skills.feedback.pending.updateAll');
      case 'update':
        return t('settings.skills.feedback.pending.update', { name: operation.name });
      case 'remove':
        return t('settings.skills.feedback.pending.remove', { name: operation.name });
      case 'enable':
        return t('settings.skills.feedback.pending.enable', { name: operation.name });
      case 'disable':
        return t('settings.skills.feedback.pending.disable', { name: operation.name });
    }
  };

  const successMessage = (operation: SkillPendingOperation): string => {
    switch (operation.kind) {
      case 'installBundle':
        return t('settings.skills.feedback.success.installBundle');
      case 'updateBundle':
        return t('settings.skills.feedback.success.updateBundle');
      case 'installSelected':
        return t('settings.skills.feedback.success.installSelected');
      case 'updateAll':
        return t('settings.skills.feedback.success.updateAll');
      case 'update':
        return t('settings.skills.feedback.success.update', { name: operation.name });
      case 'remove':
        return t('settings.skills.feedback.success.remove', { name: operation.name });
      case 'enable':
        return t('settings.skills.feedback.success.enable', { name: operation.name });
      case 'disable':
        return t('settings.skills.feedback.success.disable', { name: operation.name });
      default:
        return t('common.confirm');
    }
  };

  const run = async (
    operation: SkillPendingOperation,
    action: () => Promise<void>,
    options: { readonly clearInstallFeedback?: boolean } = {},
  ) => {
    setBusy(true);
    if (options.clearInstallFeedback) setInstallFeedback(null);
    const progress = feedback.notify(pendingMessage(operation), 0);
    try {
      await action();
      progress?.hide();
      if (operation.kind !== 'remove') refresh();
      if (mounted.current && operation.kind !== 'listRemote') {
        feedback.notify(successMessage(operation));
      }
    } catch (error) {
      progress?.hide();
      if (mounted.current) feedback.notify(error instanceof Error ? error.message : t('common.error'));
    } finally {
      progress?.hide();
      if (mounted.current) setBusy(false);
    }
  };

  const listRemote = () => {
    void run({ kind: 'listRemote' }, async () => {
      const listed = await skills.listRemote(source);
      if (mounted.current) {
        setRemote(listed);
        setSelected(new Set());
        if (listed.length === 0) feedback.notify(t('settings.skills.notices.noRemote'));
      }
    });
  };

  const installSelected = () => {
    if (selected.size === 0) {
      setInstallFeedback({ kind: 'error', message: t('settings.skills.notices.selectOne') });
      return;
    }
    void run(
      { kind: 'installSelected' },
      async () => {
        await skills.install(source, [...selected]);
        if (mounted.current) {
          setRemote([]);
          setSelected(new Set());
        }
      },
      { clearInstallFeedback: true },
    );
  };

  const installDefault = () => { void run({ kind: 'installBundle' }, () => skills.featuredBundle.install()); };
  const updateDefault = () => { void run({ kind: 'updateBundle' }, () => skills.featuredBundle.update()); };

  const toggleRemote = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const confirmRemove = (candidate: Skill) => {
    void run(
      { kind: 'remove', name: candidate.name, folderName: candidate.folderName },
      async () => {
        await skills.remove(candidate.folderName);
        if (mounted.current) {
          setEntries((current) => current.filter((skill) => skill.folderName !== candidate.folderName));
        }
      },
    );
  };

  const hasDefaultBundle = skills.featuredBundle.isInstalled();
  const description = (
    <>
      <p>{t('settings.skills.intro')}</p>
      <p>
        {`${t('settings.skills.defaultBundle.label')} `}
        <a href={featuredBundle.sourceUrl}>{featuredBundle.source}</a>
        {`. ${t('settings.skills.defaultBundle.installMore')}`}
      </p>
      <p>
        {`${t('settings.skills.remote.reviewSkillMd')} `}
        <a href={SKILLS_SH_SECURITY_URL}>{t('settings.skills.remote.securityNotice')}</a>
        .
      </p>
    </>
  );

  return (
    <SettingsPage description={description}>
      <SettingsSection>
        <SettingRow
          name={featuredBundle.name}
          description={featuredBundle.description}
        >
          <button
            type="button"
            disabled={busy}
            onClick={hasDefaultBundle ? updateDefault : installDefault}
          >
            {hasDefaultBundle
              ? t('settings.skills.defaultBundle.updateButton')
              : t('settings.skills.defaultBundle.button')}
          </button>
        </SettingRow>
        <SettingRow
          stacked
          name={t('settings.skills.remote.name')}
          description={t('settings.skills.remote.desc')}
        >
          <input
            className="pivi-settings-control"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setRemote([]);
              setSelected(new Set());
              setInstallFeedback(null);
            }}
            placeholder={featuredBundle.source}
          />
          <button
            type="button"
            disabled={busy || !source.trim()}
            onClick={listRemote}
          >
            {t('settings.skills.remote.listButton')}
          </button>
        </SettingRow>
      </SettingsSection>
      {remote.length > 0 ? (
        <SettingsSection
          title={t('settings.skills.remote.heading')}
          actions={(
            <button
              type="button"
              disabled={busy}
              aria-label={t('settings.skills.remote.clearSelected')}
              onClick={() => setSelected(new Set())}
            >
              {t('common.clear')}
            </button>
          )}
        >
          <SettingsCollection>
            {remote.map((skill) => (
              <SettingRow key={skill.name} name={skill.name} description={skill.description || undefined}>
                <input
                  type="checkbox"
                  checked={selected.has(skill.name)}
                  aria-label={t('settings.skills.installed.installAria', { name: skill.name })}
                  onChange={() => { setInstallFeedback(null); toggleRemote(skill.name); }}
                />
              </SettingRow>
            ))}
          </SettingsCollection>
          <SettingRow
            name={t('settings.skills.remote.installSelected')}
            actions={installFeedback ? <SettingsFeedback feedback={installFeedback} /> : undefined}
          >
            <button
              type="button"
              disabled={busy}
              onClick={installSelected}
            >
              {t('settings.skills.remote.installSelected')}
            </button>
          </SettingRow>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={t('settings.skills.installed.heading')}
        actions={(
          <button
            type="button"
            className="pivi-settings-action-btn"
            disabled={busy}
            aria-label={t('settings.skills.installed.updateAll')}
            onClick={() => { void run({ kind: 'updateAll' }, () => skills.updateAll()); }}
          >
            <PlatformIcon name="refresh-cw" />
          </button>
        )}
      >
        <SettingsCollection emptyState={t('settings.skills.installed.empty')}>
          {entries.map((skill) => (
            <SettingRow
              key={skill.folderName}
              name={skill.name}
              description={(
                <>
                  {skill.description ? <span>{skill.description}</span> : null}
                  {skill.description ? ' · ' : null}
                  <span>{skill.folderName}</span>
                </>
              )}
              actions={(
                <SettingsInlineActions>
                  <Toggle
                    checked={!skill.disabled}
                    disabled={busy}
                    label={skill.disabled
                      ? t('settings.skills.installed.enableAria', { name: skill.name })
                      : t('settings.skills.installed.disableAria', { name: skill.name })}
                    onChange={() => {
                      void run(
                        skill.disabled
                          ? { kind: 'enable', name: skill.name }
                          : { kind: 'disable', name: skill.name },
                        () => skills.setDisabled(skill.folderName, !skill.disabled),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="pivi-settings-action-btn"
                    disabled={busy}
                    aria-label={t('settings.skills.installed.updateAria', { name: skill.name })}
                    onClick={() => {
                      void run(
                        { kind: 'update', name: skill.name },
                        () => skills.update(skill.name, skill.folderName),
                      );
                    }}
                  >
                    <PlatformIcon name="refresh-cw" />
                  </button>
                  <SettingsRemoveButton
                    ariaLabel={t('settings.skills.installed.removeAria', { name: skill.name })}
                    disabled={busy}
                    onClick={() => { confirmRemove(skill); }}
                  />
                </SettingsInlineActions>
              )}
            />
          ))}
        </SettingsCollection>
      </SettingsSection>
    </SettingsPage>
  );
}
