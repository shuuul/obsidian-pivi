import { useEffect, useRef, useState } from 'react';

import type { Locale, TranslationKey } from '../i18n';
import { useI18n, useT } from '../i18n';
import type {
  SettingsActionsPort,
  SettingsEnvironmentPort,
  SettingsHostIntegrationSection,
  SettingsHostIntegrationsPort,
  SettingsHotkeysPort,
} from '../ports';
import { BadgeListInput, Select, SettingHeading, SettingRow, Toggle } from './controls';
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

function EnvironmentSection({ environment }: { readonly environment: SettingsEnvironmentPort }) {
  const t = useT();
  const [value, setValue] = useState(() => environment.getEnvironmentVariables('shared'));
  const reviewKeys = environment.getReviewKeys('shared', value);
  return (
    <>
      <SettingHeading>{t('settings.environment')}</SettingHeading>
      {reviewKeys.length > 0 ? (
        <div className="pivi-env-review-warning pivi-setting-validation pivi-setting-validation-warning">
          {t('settings.sharedEnvironment.reviewOwnership', { keys: reviewKeys.join(', ') })}
        </div>
      ) : null}
      <SettingRow name={t('settings.sharedEnvironment.name')} description={t('settings.sharedEnvironment.desc')}>
        <textarea
          className="pivi-settings-control pivi-settings-control--fill pivi-settings-env-textarea"
          rows={6}
          placeholder={t('settings.sharedEnvironment.placeholder')}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => { void environment.applyEnvironmentVariables('shared', value); }}
        />
      </SettingRow>
    </>
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
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
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
    });
  };

  return (
    <>
      <SettingRow name={t('settings.navMappings.name')} description={t('settings.navMappings.desc')}>
        <textarea
          className="pivi-settings-control"
          rows={3}
          placeholder="Map w scrollup\nmap s scrolldown\nmap i focusinput"
          value={text}
          onChange={(event) => {
            const nextText = event.currentTarget.value;
            const ownerWindow = event.currentTarget.ownerDocument.defaultView;
            setText(nextText);
            if (saveTimeout.current !== null) saveWindow.current?.clearTimeout(saveTimeout.current);
            saveWindow.current = ownerWindow;
            saveTimeout.current = ownerWindow?.setTimeout(() => commit(nextText, false), 500) ?? null;
          }}
          onBlur={(event) => commit(event.currentTarget.value, true)}
        />
      </SettingRow>
      {error ? <div className="pivi-setting-description">{error}</div> : null}
    </>
  );
}

export function GeneralSettingsTab({
  store,
  actions,
  environment,
  hotkeys,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
  readonly environment: SettingsEnvironmentPort;
  readonly hotkeys: SettingsHotkeysPort;
}) {
  const { general } = useSettingsUiSnapshot(store);
  const i18n = useI18n();
  const { getAvailableLocales, getLocaleDisplayName } = i18n;
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const mounted = useMountedRef();
  const save = async (patch: Parameters<SettingsUiStore['updateGeneral']>[0]): Promise<boolean> => {
    const previousLocale = i18n.getLocale();
    if (patch.locale !== undefined && !i18n.setLocale(patch.locale as Locale)) {
      setError(t('common.error'));
      return false;
    }
    try {
      await saveGeneral(store, actions, patch);
      return true;
    } catch {
      if (patch.locale !== undefined) i18n.setLocale(previousLocale);
      if (mounted.current) setError(t('common.error'));
      return false;
    }
  };
  return (
    <>
      {error ? <div className="pivi-setting-description">{error}</div> : null}
      <SettingRow name={t('settings.language.name')} description={t('settings.language.desc')}>
        <Select label={t('settings.language.name')} value={general.locale} onChange={(locale) => { void save({ locale }); }}>
          {getAvailableLocales().map((locale) => (
            <option key={locale} value={locale}>{getLocaleDisplayName(locale)}</option>
          ))}
        </Select>
      </SettingRow>
      <SettingHeading>{t('settings.layout')}</SettingHeading>
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
      <SettingHeading>{t('settings.chatBehavior')}</SettingHeading>
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
      <SettingHeading>{t('settings.compaction.title')}</SettingHeading>
      <SettingRow name={t('settings.compaction.autoCompact.name')} description={t('settings.compaction.autoCompact.desc')}>
        <Toggle checked={general.autoCompact} label={t('settings.compaction.autoCompact.name')} onChange={(autoCompact) => { void save({ autoCompact }); }} />
      </SettingRow>
      <SettingRow name={t('settings.compaction.threshold.name')} description={t('settings.compaction.threshold.desc')}>
        <input
          type="range"
          min="50"
          max="95"
          step="5"
          value={general.autoCompactThresholdPercent}
          onChange={(event) => { void save({ autoCompactThresholdPercent: Number(event.target.value) }); }}
        />
      </SettingRow>
      <SettingRow name={t('settings.compaction.keepRecent.name')} description={t('settings.compaction.keepRecent.desc')}>
        <input
          className="pivi-settings-control"
          type="number"
          min="1000"
          max="200000"
          step="1000"
          value={general.autoCompactKeepRecentTokens}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) void save({ autoCompactKeepRecentTokens: Math.min(200000, Math.max(1000, value)) });
          }}
        />
      </SettingRow>
      <SessionFilesSettingsSection actions={actions} />
      <SettingHeading>{t('settings.personalizationContext')}</SettingHeading>
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
      <SettingHeading>{t('settings.inputShortcuts')}</SettingHeading>
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
      <NavMappingsRow store={store} actions={actions} />
      <HotkeyGrid hotkeys={hotkeys} />
      <EnvironmentSection environment={environment} />
    </>
  );
}

export function SubagentsSettingsTab({
  store,
  actions,
}: {
  readonly store: SettingsUiStore;
  readonly actions: SettingsActionsPort;
}) {
  const { subagents } = useSettingsUiSnapshot(store);
  const t = useT();
  const save = (patch: Parameters<SettingsUiStore['updateSubagents']>[0]) => {
    void saveSubagents(store, actions, patch);
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

export function SessionFilesSettingsSection({ actions }: { readonly actions: SettingsActionsPort }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useMountedRef();
  const clean = async () => {
    setPending(true);
    try {
      const count = await actions.purgeDeletedSessionFiles();
      if (mounted.current) setMessage(t('settings.sessionFiles.deleteRemoved.success', { count }));
    } catch {
      if (mounted.current) setMessage(t('settings.sessionFiles.deleteRemoved.failed'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return (
    <>
      <SettingHeading>{t('settings.sessionFiles.heading')}</SettingHeading>
      <SettingRow name={t('settings.sessionFiles.deleteRemoved.name')} description={t('settings.sessionFiles.deleteRemoved.desc')}>
        <button className="pivi-button--danger" type="button" disabled={pending} onClick={() => { void clean(); }}>
          {t('settings.sessionFiles.deleteRemoved.button')}
        </button>
      </SettingRow>
      {message ? <div className="pivi-setting-description">{message}</div> : null}
    </>
  );
}

export function IntegrationsSettingsTab({ integrations }: { readonly integrations: SettingsHostIntegrationsPort }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sections, setSections] = useState<readonly SettingsHostIntegrationSection[]>([]);
  const mounted = useMountedRef();
  useEffect(() => {
    void Promise.resolve(integrations.listSections()).then((nextSections) => {
      if (mounted.current) setSections(nextSections);
    }).catch(() => {
      if (mounted.current) setMessage(t('common.error'));
    });
  }, [integrations, mounted, t]);
  const run = async (actionId: string) => {
    setPending(true);
    try {
      const result = await integrations.runAction(actionId);
      if (mounted.current) setMessage(result.message ?? null);
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return (
    <>
      {sections.map((section) => (
        <div key={section.id} className="pivi-integration-setting pivi-setting-stack">
          <SettingRow name={section.heading} description={section.description}>
            {section.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={pending || action.disabled}
                title={action.disabledReason}
                onClick={() => { void run(action.id); }}
              >
                {action.label}
              </button>
            ))}
          </SettingRow>
          {section.actions.find(action => action.disabledReason)?.disabledReason
            ? <p className="pivi-setting-description">{section.actions.find(action => action.disabledReason)?.disabledReason}</p>
            : null}
        </div>
      ))}
      {message ? <div className="pivi-setting-description">{message}</div> : null}
    </>
  );
}
