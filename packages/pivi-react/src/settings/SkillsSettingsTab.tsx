import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts, SettingsFeedbackMessage, SettingsFeedbackPort } from '../ports';
import { ModalLayer } from '../shared/ModalLayer';
import { SettingRow, SettingsActionFeedback, SettingsItemActions, SettingsListHeader, SettingsPageDescription, SettingsRemoveButton, Toggle } from './controls';

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
  const [pendingOperation, setPendingOperation] = useState<SkillPendingOperation | null>(null);
  const [remoteFeedback, setRemoteFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [installFeedback, setInstallFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [bundleFeedback, setBundleFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [installedFeedback, setInstalledFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<Skill | null>(null);
  const featuredBundle = skills.featuredBundle.getDescriptor();
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = () => { if (mounted.current) setEntries(skills.list()); };

  const pendingMessage = (operation: SkillPendingOperation | null): SettingsFeedbackMessage | null => {
    if (!operation) return null;
    switch (operation.kind) {
      case 'installBundle':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.installBundle') };
      case 'updateBundle':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.updateBundle') };
      case 'listRemote':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.listRemote') };
      case 'installSelected':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.installSelected') };
      case 'updateAll':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.updateAll') };
      case 'update':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.update', { name: operation.name }) };
      case 'remove':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.remove', { name: operation.name }) };
      case 'enable':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.enable', { name: operation.name }) };
      case 'disable':
        return { kind: 'pending', message: t('settings.skills.feedback.pending.disable', { name: operation.name }) };
      default:
        return null;
    }
  };

  const successMessage = (operation: SkillPendingOperation): SettingsFeedbackMessage => {
    switch (operation.kind) {
      case 'installBundle':
        return { kind: 'success', message: t('settings.skills.feedback.success.installBundle') };
      case 'updateBundle':
        return { kind: 'success', message: t('settings.skills.feedback.success.updateBundle') };
      case 'installSelected':
        return { kind: 'success', message: t('settings.skills.feedback.success.installSelected') };
      case 'updateAll':
        return { kind: 'success', message: t('settings.skills.feedback.success.updateAll') };
      case 'update':
        return { kind: 'success', message: t('settings.skills.feedback.success.update', { name: operation.name }) };
      case 'remove':
        return { kind: 'success', message: t('settings.skills.feedback.success.remove', { name: operation.name }) };
      case 'enable':
        return { kind: 'success', message: t('settings.skills.feedback.success.enable', { name: operation.name }) };
      case 'disable':
        return { kind: 'success', message: t('settings.skills.feedback.success.disable', { name: operation.name }) };
      default:
        return { kind: 'success', message: t('common.confirm') };
    }
  };

  const run = async (
    operation: SkillPendingOperation,
    action: () => Promise<void>,
    options: { readonly clearRemoteFeedback?: boolean; readonly clearInstallFeedback?: boolean } = {},
  ) => {
    setBusy(true);
    setPendingOperation(operation);
    if (options.clearRemoteFeedback) setRemoteFeedback(null);
    if (options.clearInstallFeedback) setInstallFeedback(null);
    setBundleFeedback(null);
    setInstalledFeedback(null);
    try {
      await action();
      refresh();
      if (mounted.current && operation.kind !== 'listRemote') {
        const feedback = successMessage(operation);
        if (operation.kind === 'installBundle' || operation.kind === 'updateBundle') {
          setBundleFeedback(feedback);
        } else {
          setInstalledFeedback(feedback);
        }
      }
    } catch (error) {
      if (mounted.current) feedback.notify(error instanceof Error ? error.message : t('common.error'));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setPendingOperation(null);
      }
    }
  };

  const listRemote = () => {
    setRemoteFeedback(null);
    void run({ kind: 'listRemote' }, async () => {
      const listed = await skills.listRemote(source);
      if (mounted.current) {
        setRemote(listed);
        setSelected(new Set());
        setRemoteFeedback(listed.length === 0
          ? { kind: 'error', message: t('settings.skills.notices.noRemote') }
          : null);
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

  const confirmRemove = () => {
    if (!removeCandidate) return;
    const candidate = removeCandidate;
    setRemoveCandidate(null);
    void run(
      { kind: 'remove', name: candidate.name, folderName: candidate.folderName },
      () => skills.remove(candidate.folderName),
    );
  };

  const hasDefaultBundle = skills.featuredBundle.isInstalled();
  const globalPendingFeedback = pendingMessage(pendingOperation);

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
        <SettingsActionFeedback feedback={pendingOperation?.kind === 'installBundle' || pendingOperation?.kind === 'updateBundle'
          ? globalPendingFeedback
          : bundleFeedback} />
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
              setRemoteFeedback(null);
              setInstallFeedback(null);
            }}
            placeholder={featuredBundle.source}
          />
          <button type="button" disabled={busy || !source.trim()} onClick={listRemote}>{t('settings.skills.remote.listButton')}</button>
          <SettingsActionFeedback feedback={pendingOperation?.kind === 'listRemote' ? globalPendingFeedback : remoteFeedback} />
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
                  onChange={() => { setInstallFeedback(null); toggleRemote(skill.name); }}
                />
                <span className="pivi-skill-choice-info">
                  <span className="pivi-sp-item-name">{skill.name}</span>
                  {skill.description ? <span className="pivi-sp-item-desc">{skill.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="pivi-skills-install-actions">
            <button
              type="button"
              className="pivi-button--primary pivi-skills-install-selected-btn"
              disabled={busy}
              onClick={installSelected}
            >
              {t('settings.skills.remote.installSelected')}
            </button>
            <SettingsActionFeedback feedback={pendingOperation?.kind === 'installSelected'
              ? globalPendingFeedback
              : installFeedback} />
          </div>
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
            onClick={() => { void run({ kind: 'updateAll' }, () => skills.updateAll()); }}
          >
            <PlatformIcon name="refresh-cw" />
          </button>
        )}
      />
      {pendingOperation?.kind === 'updateAll' ? (
        <SettingsActionFeedback feedback={globalPendingFeedback} />
      ) : null}
      {!pendingOperation && installedFeedback ? (
        <SettingsActionFeedback feedback={installedFeedback} />
      ) : null}
      {entries.length === 0 ? (
        <p className="pivi-sp-empty-state">{t('settings.skills.installed.empty')}</p>
      ) : (
        <div className="pivi-sp-list">
          {entries.map((skill) => {
            const rowPending = pendingOperation && (
              (pendingOperation.kind === 'update' && pendingOperation.name === skill.name)
              || (pendingOperation.kind === 'remove' && pendingOperation.folderName === skill.folderName)
              || (pendingOperation.kind === 'enable' && pendingOperation.name === skill.name)
              || (pendingOperation.kind === 'disable' && pendingOperation.name === skill.name)
            ) ? globalPendingFeedback : null;
            return (
              <div className="pivi-sp-item" key={skill.folderName}>
                <div className="pivi-sp-info">
                  <div className="pivi-sp-item-header">
                    <span className="pivi-sp-item-name">{skill.name}</span>
                    <span className="pivi-sp-item-folder">{skill.folderName}</span>
                  </div>
                  {skill.description ? <div className="pivi-sp-item-desc">{skill.description}</div> : null}
                </div>
                <SettingsItemActions className="pivi-sp-item-actions" isolate={false}>
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
                    onClick={() => { setRemoveCandidate(skill); }}
                  />
                </SettingsItemActions>
                {rowPending ? <SettingsActionFeedback feedback={rowPending} /> : null}
              </div>
            );
          })}
        </div>
      )}
      <ModalLayer
        ariaLabel={t('settings.skills.installed.removeConfirmTitle', { name: removeCandidate?.name ?? '' })}
        open={removeCandidate !== null}
        onClose={() => { if (!busy) setRemoveCandidate(null); }}
      >
        {removeCandidate ? (
          <div className="pivi-modal">
            <div className="pivi-modal__title">
              {t('settings.skills.installed.removeConfirmTitle', { name: removeCandidate.name })}
            </div>
            <p>{t('settings.skills.installed.removeConfirm', { name: removeCandidate.name })}</p>
            <div className="pivi-modal__actions">
              <button type="button" data-modal-cancel disabled={busy} onClick={() => setRemoveCandidate(null)}>
                {t('common.cancel')}
              </button>
              <button className="pivi-button--danger" type="button" disabled={busy} onClick={confirmRemove}>
                {t('common.remove')}
              </button>
            </div>
          </div>
        ) : null}
      </ModalLayer>
    </>
  );
}
