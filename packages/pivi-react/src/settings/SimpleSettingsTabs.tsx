import { useCallback, useEffect, useRef, useState } from 'react';

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
import { EditorToolbarSection } from './EditorToolbarSection';
import { BadgeListInput, Select, SettingRow, SettingsCollection, SettingsFeedback, SettingsPage, SettingsSection, Toggle } from './primitives';
import type { SettingsUiStore } from './SettingsUiStore';
import { useSettingsUiSnapshot } from './SettingsUiStore';
import type { SettingsGeneralSnapshot } from './types';

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

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

function DeadlineSecondsInput({ valueMs, label, onCommit }: {
  readonly valueMs: number;
  readonly label: string;
  readonly onCommit: (valueMs: number) => void;
}) {
  const [draft, setDraft] = useState(String(valueMs / 1000));
  useEffect(() => setDraft(String(valueMs / 1000)), [valueMs]);
  const commit = () => {
    const seconds = Number(draft);
    const nextMs = Number.isFinite(seconds) && seconds >= 0
      ? Math.floor(seconds * 1000)
      : valueMs;
    setDraft(String(nextMs / 1000));
    if (nextMs !== valueMs) onCommit(nextMs);
  };
  return (
    <input
      className="pivi-settings-control"
      type="number"
      inputMode="decimal"
      min="0"
      step="1"
      aria-label={label}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
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

export function EnvironmentSection({ environment, feedback }: {
  readonly environment: SettingsEnvironmentPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const t = useT();
  const [entries, setEntries] = useState(() => environment.listEntries('shared'));
  const [value, setValue] = useState(() => environmentEntriesToSafeText(environment.listEntries('shared')));
  const [savedValue, setSavedValue] = useState(value);
  const [applying, setApplying] = useState(false);
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
    void environment.importEnvironmentText('shared', value)
      .then(() => {
        refreshEntries();
      })
      .catch((cause: unknown) => {
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

  const entryValue = (entry: SettingsEnvironmentEntryView): string => {
    if (entry.sourceKind === 'secret') {
      return entry.hasStoredSecret
        ? t('settings.sharedEnvironment.secretStored')
        : t('settings.sharedEnvironment.secretMissing');
    }
    if (entry.sourceKind === 'systemEnvironment') {
      return `$${entry.systemName ?? entry.key}`;
    }
    return entry.plainValue ?? '';
  };

  return (
    <SettingsPage description={t('settings.pages.environment.description')}>
      <SettingsSection>
        {reviewKeys.length > 0 ? (
          <div className="pivi-env-review-warning pivi-setting-validation pivi-setting-validation-warning">
            {t('settings.sharedEnvironment.reviewOwnership', { keys: reviewKeys.join(', ') })}
          </div>
        ) : null}
        {entries.length > 0 ? (
          <SettingsCollection>
            {entries.map((entry) => (
              <SettingRow
                key={`${entry.scope}:${entry.key}`}
                name={entry.key}
                description={`${storageLabel(entry.storageLocation)} · ${entryValue(entry)}`}
              />
            ))}
          </SettingsCollection>
        ) : null}
        <SettingRow
          stacked
          name={t('settings.sharedEnvironment.name')}
          description={t('settings.sharedEnvironment.desc')}
        >
          <textarea
            className="pivi-settings-control pivi-settings-control--fill pivi-settings-env-textarea"
            rows={6}
            placeholder={t('settings.sharedEnvironment.placeholder')}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <div className="pivi-settings-action-group">
            <button type="button" className="pivi-button--primary" disabled={!isDirty || applying} onClick={apply}>
              {t('settings.sharedEnvironment.apply')}
            </button>
          </div>
        </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

function HotkeyRows({ hotkeys }: { readonly hotkeys: SettingsHotkeysPort }) {
  const t = useT();
  return (
    <>
      {hotkeys.listHotkeys().map((row) => (
        <SettingRow key={row.commandId} name={t(row.labelKey as TranslationKey)} centered>
          <button
            type="button"
            aria-label={t('settings.hotkeys.openHotkeys')}
            onClick={() => hotkeys.openHotkeySettings()}
          >
            {row.hotkey
              ? <span className="pivi-hotkey-badge">{row.hotkey}</span>
              : t('settings.hotkeys.notSet')}
          </button>
        </SettingRow>
      ))}
    </>
  );
}

export function GeneralSettingsTab({
  page,
  store,
  actions,
  feedback,
  hotkeys,
  integrations,
}: {
  readonly page: 'general' | 'appearance' | 'chat' | 'personalization' | 'input' | 'sessions';
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
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
      {page === 'general' ? <SettingsSection>
        <SettingRow name={t('settings.language.name')} description={t('settings.language.desc')}>
          <Select label={t('settings.language.name')} value={general.locale} onChange={(locale) => { void save({ locale }); }}>
            {getAvailableLocales().map((locale) => (
              <option key={locale} value={locale}>{getLocaleDisplayName(locale)}</option>
            ))}
          </Select>
        </SettingRow>
      </SettingsSection> : null}
      {page === 'appearance' ? <SettingsSection title={t('settings.layout')}>
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
      </SettingsSection> : null}
      {page === 'chat' ? <SettingsSection>
        <SettingRow name={t('settings.enableAutoScroll.name')} description={t('settings.enableAutoScroll.desc')}>
          <Toggle checked={general.enableAutoScroll} label={t('settings.enableAutoScroll.name')} onChange={(enableAutoScroll) => { void save({ enableAutoScroll }); }} />
        </SettingRow>
        <SettingRow name={t('settings.showCacheHitRate.name')} description={t('settings.showCacheHitRate.desc')}>
          <Toggle checked={general.showCacheHitRate} label={t('settings.showCacheHitRate.name')} onChange={(showCacheHitRate) => { void save({ showCacheHitRate }); }} />
        </SettingRow>
        <SettingRow name={t('settings.showTokensPerSecond.name')} description={t('settings.showTokensPerSecond.desc')}>
          <Toggle checked={general.showTokensPerSecond} label={t('settings.showTokensPerSecond.name')} onChange={(showTokensPerSecond) => { void save({ showTokensPerSecond }); }} />
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
      </SettingsSection> : null}
      {page === 'chat' ? <SettingsSection title={t('settings.providerRequests.title')}>
        <SettingRow
          name={t('settings.providerRequests.total.name')}
          description={t('settings.providerRequests.total.desc')}
        >
          <DeadlineSecondsInput
            valueMs={general.providerRequestDeadlines.totalMs}
            label={t('settings.providerRequests.total.name')}
            onCommit={totalMs => { void save({
              providerRequestDeadlines: { ...general.providerRequestDeadlines, totalMs },
            }); }}
          />
        </SettingRow>
        <SettingRow
          name={t('settings.providerRequests.idle.name')}
          description={t('settings.providerRequests.idle.desc')}
        >
          <DeadlineSecondsInput
            valueMs={general.providerRequestDeadlines.idleMs}
            label={t('settings.providerRequests.idle.name')}
            onCommit={idleMs => { void save({
              providerRequestDeadlines: { ...general.providerRequestDeadlines, idleMs },
            }); }}
          />
        </SettingRow>
      </SettingsSection> : null}
      {page === 'sessions' ? <SessionFilesSettingsSection
        actions={actions}
        feedback={feedback}
        general={general}
        saveGeneral={async (patch) => { await save(patch); }}
      /> : null}
      {page === 'personalization' ? <SettingsSection>
        <SettingRow name={t('settings.userName.name')} description={t('settings.userName.desc')}>
          <input
            className="pivi-settings-control"
            value={general.userName}
            placeholder={t('settings.userName.name')}
            onChange={(event) => { void save({ userName: event.target.value }); }}
          />
        </SettingRow>
        <SettingRow stacked name={t('settings.excludedTags.name')} description={t('settings.excludedTags.desc')}>
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
      </SettingsSection> : null}
      {page === 'input' ? <SettingsSection>
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
        <HotkeyRows hotkeys={hotkeys} />
      </SettingsSection> : null}
      {page === 'appearance' ? <SettingsSection title={t('settings.styleSettings.name')}>
        <IntegrationsSettingsSection
          integrations={integrations}
          feedback={feedback}
          sectionIds={['obsidian:style-settings']}
          showOuterHeading={false}
        />
      </SettingsSection> : null}
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

export function SessionFilesSettingsSection({ actions, feedback, general, saveGeneral }: {
  readonly actions: SettingsActionsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly general: SettingsGeneralSnapshot;
  readonly saveGeneral: (patch: Partial<SettingsGeneralSnapshot>) => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<'archived' | 'deleted' | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [retentionText, setRetentionText] = useState(String(general.deletedSessionRetentionDays ?? 30));
  const mounted = useMountedRef();
  const refreshCounts = useCallback(async () => {
    const snapshot = await actions.loadSessionMaintenance();
    if (mounted.current) {
      setArchivedCount(snapshot.archivedCount);
      setDeletedCount(snapshot.deletedCount);
    }
  }, [actions, mounted]);
  useEffect(() => {
    setRetentionText(String(general.deletedSessionRetentionDays ?? 30));
  }, [general.deletedSessionRetentionDays]);
  useEffect(() => {
    void refreshCounts().catch(() => undefined);
  }, [refreshCounts]);
  const commitRetention = () => {
    const parsed = Number(retentionText.trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setRetentionText(String(general.deletedSessionRetentionDays ?? 30));
      return;
    }
    const value = Math.max(1, Math.min(3650, parsed));
    setRetentionText(String(value));
    if (value !== general.deletedSessionRetentionDays) {
      void saveGeneral({ deletedSessionRetentionDays: value });
    }
  };
  const deleteArchived = async () => {
    setPending(true);
    try {
      const result = await actions.deleteAllArchivedChats();
      await refreshCounts();
      if (mounted.current) {
        feedback.notify(t('settings.sessionFiles.deleteArchived.success', {
          moved: result.moved,
          skippedActive: result.skippedActive,
          failed: result.failed,
        }));
      }
    } catch {
      if (mounted.current) feedback.notify(t('settings.sessionFiles.deleteArchived.failed'));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmOpen(null);
      }
    }
  };
  const clean = async () => {
    setPending(true);
    try {
      const count = await actions.purgeDeletedSessionFiles();
      await refreshCounts();
      if (mounted.current) feedback.notify(t('settings.sessionFiles.deleteRemoved.success', { count }));
    } catch {
      if (mounted.current) feedback.notify(t('settings.sessionFiles.deleteRemoved.failed'));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmOpen(null);
      }
    }
  };
  return (
    <SettingsSection>
      <SettingRow
        name={t('settings.sessionFiles.archived.name')}
        description={archivedCount > 0
          ? t('settings.sessionFiles.archived.count', { count: archivedCount })
          : t('settings.sessionFiles.archived.empty')}
      />
      <SettingRow
        name={t('settings.sessionFiles.deleted.name')}
        description={deletedCount > 0
          ? `${t('settings.sessionFiles.deleted.count', { count: deletedCount })} ${t('settings.sessionFiles.deleted.recovery')}`
          : t('settings.sessionFiles.deleted.empty')}
      />
      <SettingRow name={t('settings.sessionFiles.retention.name')} description={t('settings.sessionFiles.retention.desc')}>
        <input
          className="pivi-settings-control"
          type="number"
          aria-label={t('settings.sessionFiles.retention.name')}
          min={1}
          max={3650}
          value={retentionText}
          onChange={(event) => setRetentionText(event.currentTarget.value)}
          onBlur={commitRetention}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </SettingRow>
      <SettingRow
        centered
        name={t('settings.sessionFiles.deleteArchived.name')}
        description={t('settings.sessionFiles.deleteArchived.desc')}
      >
        <button
          className={confirmOpen === 'archived' ? 'pivi-settings-confirm-delete-btn' : undefined}
          type="button"
          disabled={pending || archivedCount === 0}
          onClick={() => {
            if (confirmOpen === 'archived') void deleteArchived();
            else setConfirmOpen('archived');
          }}
        >
          {confirmOpen === 'archived' ? t('common.confirmDelete') : t('settings.sessionFiles.deleteArchived.button')}
        </button>
      </SettingRow>
      <SettingRow
        centered
        name={t('settings.sessionFiles.deleteRemoved.name')}
        description={t('settings.sessionFiles.deleteRemoved.desc')}
      >
        <button
          className={confirmOpen === 'deleted' ? 'pivi-settings-confirm-delete-btn' : undefined}
          type="button"
          disabled={pending || deletedCount === 0}
          onClick={() => {
            if (confirmOpen === 'deleted') void clean();
            else setConfirmOpen('deleted');
          }}
        >
          {confirmOpen === 'deleted' ? t('common.confirmDelete') : t('settings.sessionFiles.deleteRemoved.button')}
        </button>
      </SettingRow>
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
        <SettingsFeedback feedback={loadFeedback} />
        {sections.map((section) => (
          <SettingRow
            key={section.id}
            className="pivi-integration-setting"
            centered
            name={section.heading}
            description={section.description}
          >
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
                <SettingsFeedback
                  feedback={actionFeedback[action.id] ?? (
                    action.disabledReason
                      ? { kind: 'error' as const, message: action.disabledReason }
                      : null
                  )}
                />
              </span>
            ))}
          </SettingRow>
        ))}
      </>
    );
  }
  return (
    <SettingsSection title={t('settings.integrations.heading')}>
      <SettingsFeedback feedback={loadFeedback} />
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
                  <SettingsFeedback feedback={actionFeedback[action.id] ?? disabledFeedback} />
                </span>
              );
            })}
          </SettingRow>
        </div>
      ))}
    </SettingsSection>
  );
}
