import { useEffect, useRef, useState } from 'react';

import type { Locale, TranslationKey } from '../i18n';
import { useI18n, useT } from '../i18n';
import type {
  SettingsActionsPort,
  SettingsEditorToolbarPort,
  SettingsEnvironmentEntryView,
  SettingsEnvironmentPort,
  SettingsFeedbackMessage,
  SettingsFeedbackPort,
  SettingsHostIntegrationSection,
  SettingsHostIntegrationsPort,
  SettingsHotkeysPort,
} from '../ports';
import { ModalLayer } from '../shared/ModalLayer';
import { BadgeListInput, Select, SettingRow, SettingsActionFeedback, SettingsSection, Toggle } from './controls';
import { EditorToolbarSection } from './EditorToolbarSection';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import type { SettingsUiStore } from './SettingsUiStore';
import { useSettingsUiSnapshot } from './SettingsUiStore';

async function saveGeneral(
  store: SettingsUiStore,
  actions: SettingsActionsPort,
  patch: Parameters<SettingsUiStore['updateGeneral']>[0],
) {
  const previous = store.getSnapshot().general;
  store.updateGeneral(patch);
  try {
    await actions.saveGeneral(patch);
  } catch (error) {
    store.updateGeneral(previous);
    throw error;
  }
}

async function saveSubagents(
  store: SettingsUiStore,
  actions: SettingsActionsPort,
  patch: Parameters<SettingsUiStore['updateSubagents']>[0],
) {
  const previous = store.getSnapshot().subagents;
  store.updateSubagents(patch);
  try {
    await actions.saveSubagents(patch);
  } catch (error) {
    store.updateSubagents(previous);
    throw error;
  }
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

function environmentEntriesToSafeText(entries: readonly SettingsEnvironmentEntryView[]): string {
  return entries.map((entry) => {
    if (entry.sourceKind === 'secret') {
      return `${entry.key}=`;
    }
    if (entry.sourceKind === 'systemEnvironment') {
      return `${entry.key}=$${entry.systemName ?? entry.key}`;
    }
    return `${entry.key}=${entry.plainValue ?? ''}`;
  }).join('\n');
}

function EnvironmentSection({ environment, feedback }: {
  readonly environment: SettingsEnvironmentPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const t = useT();
  const [entries, setEntries] = useState(() => environment.listEntries('shared'));
  const [value, setValue] = useState(() => environmentEntriesToSafeText(environment.listEntries('shared')));
  const [savedValue, setSavedValue] = useState(value);
  const [applying, setApplying] = useState(false);
  const [applyFeedback, setApplyFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const reviewKeys = environment.getReviewKeys('shared', value);
  const isDirty = value !== savedValue;

  const refreshEntries = () => {
    const next = environment.listEntries('shared');
    const nextValue = environmentEntriesToSafeText(next);
    setEntries(next);
    setValue(nextValue);
    setSavedValue(nextValue);
  };

  const apply = () => {
    setApplying(true);
    setApplyFeedback({ kind: 'pending', message: t('settings.sharedEnvironment.pending') });
    void environment.importEnvironmentText('shared', value)
      .then(() => {
        refreshEntries();
        setApplyFeedback({ kind: 'success', message: t('settings.sharedEnvironment.success') });
      })
      .catch((cause: unknown) => {
        setApplyFeedback(null);
        feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      })
      .finally(() => {
        setApplying(false);
      });
  };

  const storageLabel = (location: SettingsEnvironmentEntryView['storageLocation']) => {
    if (location === 'secureStorage') {
      return t('settings.sharedEnvironment.storageSecure');
    }
    if (location === 'systemEnvironment') {
      return t('settings.sharedEnvironment.storageSystem');
    }
    return t('settings.sharedEnvironment.storageDeviceLocal');
  };

  return (
    <SettingsSection title={t('settings.environment')}>
      {reviewKeys.length > 0 ? (
        <div className="pivi-env-review-warning pivi-setting-validation pivi-setting-validation-warning">
          {t('settings.sharedEnvironment.reviewOwnership', { keys: reviewKeys.join(', ') })}
        </div>
      ) : null}
      {entries.length > 0 ? (
        <div className="pivi-env-entry-list" role="list">
          {entries.map((entry) => (
            <div key={`${entry.scope}:${entry.key}`} className="pivi-env-entry-row" role="listitem">
              <span className="pivi-env-entry-key">{entry.key}</span>
              <span className="pivi-env-entry-source">{storageLabel(entry.storageLocation)}</span>
              <span className="pivi-env-entry-value">
                {entry.sourceKind === 'secret'
                  ? (entry.hasStoredSecret
                    ? t('settings.sharedEnvironment.secretStored')
                    : t('settings.sharedEnvironment.secretMissing'))
                  : entry.sourceKind === 'systemEnvironment'
                    ? `$${entry.systemName ?? entry.key}`
                    : (entry.plainValue ?? '')}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <SettingRow name={t('settings.sharedEnvironment.name')} description={t('settings.sharedEnvironment.desc')}>
        <textarea
          className="pivi-settings-control pivi-settings-control--fill pivi-settings-env-textarea"
          rows={6}
          placeholder={t('settings.sharedEnvironment.placeholder')}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setApplyFeedback(null);
          }}
          aria-label={t('settings.sharedEnvironment.name')}
        />
        <button type="button" className="pivi-button--primary" disabled={!isDirty || applying} onClick={apply}>
          {t('settings.sharedEnvironment.apply')}
        </button>
        <SettingsActionFeedback feedback={applyFeedback} />
      </SettingRow>
    </SettingsSection>
  );
}

function HotkeyGrid({ hotkeys }: { readonly hotkeys: SettingsHotkeysPort }) {
  const t = useT();
  const rows = hotkeys.listHotkeys();
  return (
    <div className="pivi-hotkey-grid">
      {rows.map((row) => (
        <button
          key={row.commandId}
          type="button"
          className="pivi-hotkey-item"
          onClick={() => hotkeys.openHotkeySettings()}
        >
          <span className="pivi-hotkey-name">{t(row.labelKey as TranslationKey)}</span>
          {row.hotkey ? <span className="pivi-hotkey-badge">{row.hotkey}</span> : null}
        </button>
      ))}
    </div>
  );
}

function NavMappingsRow({
  store,
  actions,
  feedback,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const { general } = useSettingsUiSnapshot(store);
  const t = useT();
  const [text, setText] = useState(() => buildNavMappingText(general.keyboardNavigation));
  const [error, setError] = useState<string | null>(null);
  const saveTimeout = useRef<number | null>(null);
  const saveWindow = useRef<Window | null>(null);

  useEffect(() => {
    setText(buildNavMappingText(general.keyboardNavigation));
  }, [general.keyboardNavigation]);

  useEffect(() => () => {
    if (saveTimeout.current !== null) {
      saveWindow.current?.clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
  }, []);

  const commit = (nextText: string, showError: boolean) => {
    if (saveTimeout.current !== null) {
      saveWindow.current?.clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    const result = parseNavMappings(nextText);
    if (!result.settings) {
      if (showError) {
        setError(result.error ?? t('common.error'));
        setText(buildNavMappingText(general.keyboardNavigation));
      }
      return;
    }
    setError(null);
    void saveGeneral(store, actions, {
      keyboardNavigation: {
        scrollUpKey: result.settings.scrollUp,
        scrollDownKey: result.settings.scrollDown,
        focusInputKey: result.settings.focusInput,
      },
    }).catch((cause: unknown) => {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  return (
    <>
      <SettingRow name={t('settings.navMappings.name')} description={t('settings.navMappings.desc')}>
        <div className="pivi-settings-control-feedback">
          <textarea
            className="pivi-settings-control"
            rows={3}
            placeholder="Map w scrollup\nmap s scrolldown\nmap i focusinput"
            value={text}
            onChange={(event) => {
              const nextText = event.currentTarget.value;
              const ownerWindow = event.currentTarget.ownerDocument.defaultView;
              setText(nextText);
              setError(null);
              if (saveTimeout.current !== null) saveWindow.current?.clearTimeout(saveTimeout.current);
              saveWindow.current = ownerWindow;
              saveTimeout.current = ownerWindow?.setTimeout(() => commit(nextText, false), 500) ?? null;
            }}
            onBlur={(event) => commit(event.currentTarget.value, true)}
          />
          <SettingsActionFeedback feedback={error ? { kind: 'error', message: error } : undefined} />
        </div>
      </SettingRow>
    </>
  );
}

export function GeneralSettingsTab({
  store,
  actions,
  environment,
  feedback,
  hotkeys,
  integrations,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly environment: SettingsEnvironmentPort;
  readonly feedback: SettingsFeedbackPort;
  readonly hotkeys: SettingsHotkeysPort;
  readonly integrations: SettingsHostIntegrationsPort;
}) {
  const { general } = useSettingsUiSnapshot(store);
  const i18n = useI18n();
  const { getAvailableLocales, getLocaleDisplayName } = i18n;
  const t = useT();
  const mounted = useMountedRef();
  const save = async (patch: Parameters<SettingsUiStore['updateGeneral']>[0]): Promise<boolean> => {
    const previousLocale = i18n.getLocale();
    if (patch.locale !== undefined && !i18n.setLocale(patch.locale as Locale)) {
      feedback.notify(t('common.error'));
      return false;
    }
    try {
      await saveGeneral(store, actions, patch);
      return true;
    } catch (cause) {
      if (patch.locale !== undefined) i18n.setLocale(previousLocale);
      if (mounted.current) feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      return false;
    }
  };
  return (
    <>
      <SettingRow name={t('settings.language.name')} description={t('settings.language.desc')}>
        <Select label={t('settings.language.name')} value={general.locale} onChange={(locale) => { void save({ locale }); }}>
          {getAvailableLocales().map((locale) => (
            <option key={locale} value={locale}>{getLocaleDisplayName(locale)}</option>
          ))}
        </Select>
      </SettingRow>
      <SettingsSection title={t('settings.layout')}>
        <SettingRow name={t('settings.chatViewPlacement.name')} description={t('settings.chatViewPlacement.desc')}>
          <Select
            label={t('settings.chatViewPlacement.name')}
            value={general.chatViewPlacement}
            onChange={(value) => { void save({ chatViewPlacement: value as typeof general.chatViewPlacement }); }}
          >
            <option value="right-sidebar">{t('settings.chatViewPlacement.rightSidebar')}</option>
            <option value="left-sidebar">{t('settings.chatViewPlacement.leftSidebar')}</option>
            <option value="main-tab">{t('settings.chatViewPlacement.mainTab')}</option>
          </Select>
        </SettingRow>
        <SettingRow name={t('settings.tabBarPosition.name')} description={t('settings.tabBarPosition.desc')}>
          <Select
            label={t('settings.tabBarPosition.name')}
            value={general.tabBarPosition}
            onChange={(value) => { void save({ tabBarPosition: value as typeof general.tabBarPosition }); }}
          >
            <option value="header">{t('settings.tabBarPosition.header')}</option>
            <option value="input">{t('settings.tabBarPosition.input')}</option>
          </Select>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t('settings.chatBehavior')}>
        <SettingRow name={t('settings.enableAutoScroll.name')} description={t('settings.enableAutoScroll.desc')}>
          <Toggle checked={general.enableAutoScroll} label={t('settings.enableAutoScroll.name')} onChange={(enableAutoScroll) => { void save({ enableAutoScroll }); }} />
        </SettingRow>
        <SettingRow
          name={t('settings.deferMathRenderingDuringStreaming.name')}
          description={t('settings.deferMathRenderingDuringStreaming.desc')}
        >
          <Toggle
            checked={general.deferMathRenderingDuringStreaming}
            label={t('settings.deferMathRenderingDuringStreaming.name')}
            onChange={(deferMathRenderingDuringStreaming) => { void save({ deferMathRenderingDuringStreaming }); }}
          />
        </SettingRow>
        <SettingRow name={t('settings.autoTitle.name')} description={t('settings.autoTitle.desc')}>
          <Toggle
            checked={general.enableAutoTitleGeneration}
            label={t('settings.autoTitle.name')}
            onChange={(enableAutoTitleGeneration) => { void save({ enableAutoTitleGeneration }); }}
          />
        </SettingRow>
      </SettingsSection>
      <SessionFilesSettingsSection actions={actions} feedback={feedback} />
      <SettingsSection title={t('settings.personalizationContext')}>
        <SettingRow name={t('settings.userName.name')} description={t('settings.userName.desc')}>
          <input
            className="pivi-settings-control"
            value={general.userName}
            placeholder={t('settings.userName.name')}
            onChange={(event) => { void save({ userName: event.target.value }); }}
          />
        </SettingRow>
        <div className="pivi-setting-stack">
          <SettingRow name={t('settings.excludedTags.name')} description={t('settings.excludedTags.desc')}>
            <BadgeListInput
              values={general.excludedTags}
              placeholder={t('settings.excludedTags.placeholder')}
              inputLabel={t('settings.excludedTags.inputLabel')}
              removeLabel={(value) => t('settings.excludedTags.removeAria', { value })}
              onAdd={(entries) => {
                const normalized = entries.map(entry => entry.replace(/^#+/, '').trim()).filter(Boolean);
                const next = [...new Set([...general.excludedTags, ...normalized])];
                return next.length === general.excludedTags.length
                  ? true
                  : save({ excludedTags: next });
              }}
              onRemove={async (value) => { await save({ excludedTags: general.excludedTags.filter(entry => entry !== value) }); }}
            />
          </SettingRow>
        </div>
      </SettingsSection>
      <SettingsSection title={t('settings.inputShortcuts')}>
        <SettingRow
          name={t('settings.requireCommandOrControlEnterToSend.name')}
          description={t('settings.requireCommandOrControlEnterToSend.desc')}
        >
          <Toggle
            checked={general.requireCommandOrControlEnterToSend}
            label={t('settings.requireCommandOrControlEnterToSend.name')}
            onChange={(requireCommandOrControlEnterToSend) => { void save({ requireCommandOrControlEnterToSend }); }}
          />
        </SettingRow>
        <NavMappingsRow store={store} actions={actions} feedback={feedback} />
        <HotkeyGrid hotkeys={hotkeys} />
      </SettingsSection>
      <EnvironmentSection environment={environment} feedback={feedback} />
      <IntegrationsSettingsSection
        integrations={integrations}
        feedback={feedback}
        sectionIds={['obsidian:style-settings']}
        showOuterHeading={false}
      />
    </>
  );
}

export function ToolbarSettingsTab({
  store,
  actions,
  editorToolbar,
  feedback,
  integrations,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly editorToolbar: SettingsEditorToolbarPort;
  readonly feedback: SettingsFeedbackPort;
  readonly integrations: SettingsHostIntegrationsPort;
}) {
  return (
    <>
      <EditorToolbarSection
        store={store}
        actions={actions}
        editorToolbar={editorToolbar}
        feedback={feedback}
      />
    </>
  );
}

export function SubagentsSettingsTab({
  store,
  actions,
  feedback,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const { subagents } = useSettingsUiSnapshot(store);
  const t = useT();
  const save = (patch: Parameters<SettingsUiStore['updateSubagents']>[0]) => {
    void saveSubagents(store, actions, patch).catch((cause: unknown) => {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    });
  };
  return (
    <>
      <SettingRow name={t('settings.subagents.enableSpawn.name')} description={t('settings.subagents.enableSpawn.desc')}>
        <Toggle checked={subagents.enabled} label={t('settings.subagents.enableSpawn.name')} onChange={(enabled) => save({ enabled })} />
      </SettingRow>
      <SettingRow name={t('settings.subagents.allowBackground.name')} description={t('settings.subagents.allowBackground.desc')}>
        <Toggle checked={subagents.allowBackground} label={t('settings.subagents.allowBackground.name')} onChange={(allowBackground) => save({ allowBackground })} />
      </SettingRow>
      <SettingRow name={t('settings.subagents.maxConcurrent.name')} description={t('settings.subagents.maxConcurrent.desc')}>
        <Select
          label={t('settings.subagents.maxConcurrent.name')}
          value={String(subagents.maxConcurrentSubagents)}
          onChange={(value) => save({ maxConcurrentSubagents: Number(value) as typeof subagents.maxConcurrentSubagents })}
        >
          {[1, 2, 3, 4, 8].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </SettingRow>
    </>
  );
}

export function SessionFilesSettingsSection({ actions, feedback }: {
  readonly actions: SettingsActionsPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mounted = useMountedRef();
  const clean = async () => {
    setPending(true);
    try {
      const count = await actions.purgeDeletedSessionFiles();
      if (mounted.current) feedback.notify(t('settings.sessionFiles.deleteRemoved.success', { count }));
    } catch {
      if (mounted.current) feedback.notify(t('settings.sessionFiles.deleteRemoved.failed'));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmOpen(false);
      }
    }
  };
  return (
    <SettingsSection title={t('settings.sessionFiles.heading')}>
      <SettingRow name={t('settings.sessionFiles.deleteRemoved.name')} description={t('settings.sessionFiles.deleteRemoved.desc')}>
        <button className="pivi-button--danger" type="button" disabled={pending} onClick={() => setConfirmOpen(true)}>
          {t('settings.sessionFiles.deleteRemoved.button')}
        </button>
      </SettingRow>
      <ModalLayer
        ariaLabel={t('settings.sessionFiles.deleteRemoved.confirmTitle')}
        open={confirmOpen}
        onClose={() => { if (!pending) setConfirmOpen(false); }}
      >
        <div className="pivi-modal">
          <div className="pivi-modal__title">{t('settings.sessionFiles.deleteRemoved.confirmTitle')}</div>
          <p>{t('settings.sessionFiles.deleteRemoved.confirmDescription')}</p>
          <div className="pivi-modal__actions">
            <button type="button" data-modal-cancel disabled={pending} onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="pivi-button--danger" type="button" disabled={pending} onClick={() => { void clean(); }}>
              {t('settings.sessionFiles.deleteRemoved.button')}
            </button>
          </div>
        </div>
      </ModalLayer>
    </SettingsSection>
  );
}

export function IntegrationsSettingsSection({
  integrations,
  feedback,
  sectionIds,
  showOuterHeading = true,
}: {
  readonly integrations: SettingsHostIntegrationsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly sectionIds?: readonly string[];
  readonly showOuterHeading?: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [loadFeedback, setLoadFeedback] = useState<SettingsFeedbackMessage | null>(null);
  const [actionFeedback, setActionFeedback] = useState<Readonly<Record<string, SettingsFeedbackMessage>>>({});
  const [sections, setSections] = useState<readonly SettingsHostIntegrationSection[]>([]);
  const mounted = useMountedRef();
  useEffect(() => {
    const result = integrations.listSections();
    const apply = (nextSections: readonly SettingsHostIntegrationSection[]) => {
      const filtered = sectionIds
        ? nextSections.filter((section) => sectionIds.includes(section.id))
        : nextSections;
      if (mounted.current) setSections(filtered);
    };
    if (Array.isArray(result)) {
      apply(result);
      return;
    }
    const pendingSections = result as Promise<readonly SettingsHostIntegrationSection[]>;
    void pendingSections.then(apply).catch(() => {
      if (mounted.current) setLoadFeedback({ kind: 'error', message: t('common.error') });
    });
  }, [integrations, mounted, sectionIds, t]);
  const run = async (actionId: string) => {
    setPending(true);
    setActionFeedback(current => {
      const next = { ...current };
      delete next[actionId];
      return next;
    });
    try {
      const result = await integrations.runAction(actionId);
      const nextFeedback = result.feedback;
      if (mounted.current && nextFeedback) {
        feedback.notify(nextFeedback.message);
        if (nextFeedback.kind === 'error') {
          setActionFeedback(current => ({ ...current, [actionId]: nextFeedback }));
        }
      }
    } catch (cause) {
      if (mounted.current) feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  if (!showOuterHeading) {
    return (
      <>
        <SettingsActionFeedback feedback={loadFeedback} />
        {sections.map((section) => (
          <SettingsSection key={section.id} title={section.heading}>
            <p className="pivi-setting-description">{section.description}</p>
            <div className="pivi-settings-action-group">
              {section.actions.map((action) => (
                <span className="pivi-settings-action-group" key={action.id}>
                  <button
                    type="button"
                    disabled={pending || action.disabled}
                    title={action.disabledReason}
                    onClick={() => { void run(action.id); }}
                  >
                    {action.label}
                  </button>
                  <SettingsActionFeedback
                    feedback={actionFeedback[action.id] ?? (
                      action.disabledReason
                        ? { kind: 'error' as const, message: action.disabledReason }
                        : null
                    )}
                  />
                </span>
              ))}
            </div>
          </SettingsSection>
        ))}
      </>
    );
  }
  return (
    <SettingsSection title={t('settings.integrations.heading')}>
      <SettingsActionFeedback feedback={loadFeedback} />
      {sections.map((section) => (
        <div key={section.id} className="pivi-integration-setting pivi-setting-stack">
          <SettingRow name={section.heading} description={section.description}>
            {section.actions.map((action) => {
              const disabledFeedback = action.disabledReason
                ? { kind: 'error' as const, message: action.disabledReason }
                : null;
              return (
                <span className="pivi-settings-action-group" key={action.id}>
                  <button
                    type="button"
                    disabled={pending || action.disabled}
                    title={action.disabledReason}
                    onClick={() => { void run(action.id); }}
                  >
                    {action.label}
                  </button>
                  <SettingsActionFeedback feedback={actionFeedback[action.id] ?? disabledFeedback} />
                </span>
              );
            })}
          </SettingRow>
        </div>
      ))}
    </SettingsSection>
  );
}
