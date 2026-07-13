import type { PiAgentSettingsView } from '@pivi/pivi-agent-core/foundation/settingsModelKey';
import { type MouseEvent, useState } from 'react';

import { useT } from '../../i18n';
import { ProviderLogo } from '../../icons';
import type { SettingsCatalogPort, SettingsModelsPort } from '../../ports';
import { CodexSection } from './CodexSection';
import { CustomProviderPanel } from './CustomProviderPanel';
import { ModelChecklist } from './ModelChecklist';
import { ProviderCredentials } from './ProviderCredentials';
import { STATUS_DESC_KEYS, STATUS_LABEL_KEYS } from './statusLabels';

export interface ProviderCardProps {
  readonly models: SettingsModelsPort;
  readonly catalog: SettingsCatalogPort;
  readonly providerId: string;
  readonly settings: PiAgentSettingsView;
  readonly expanded: boolean;
  readonly onToggleExpanded: (providerId: string, open?: boolean) => void;
  readonly save: (patch: Parameters<SettingsModelsPort['saveSettings']>[0]) => Promise<void>;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}

/** One collapsible provider card in the models settings list. */
export function ProviderCard({
  models,
  catalog,
  providerId,
  settings,
  expanded,
  onToggleExpanded,
  save,
  onChanged,
  onError,
}: ProviderCardProps) {
  const t = useT();
  const [testing, setTesting] = useState(false);

  const custom = settings.customProviders.find(entry => entry.id === providerId);
  const displayName = custom?.name ?? models.getProviderDisplayName(providerId);
  const disabled = settings.disabledProviders.includes(providerId);
  const logoSlug = models.getProviderLogoSlug(providerId);
  const readiness = models.getReadiness(providerId);
  const allowKeyless = !!custom && custom.apiKeyRequired === false;
  const isCodex = providerId === models.codexProviderId;

  const stop = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleDisabled = (event: MouseEvent): void => {
    stop(event);
    const next = new Set(settings.disabledProviders);
    if (next.has(providerId)) next.delete(providerId);
    else next.add(providerId);
    void save({ disabledProviders: [...next] }).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const remove = (event: MouseEvent): void => {
    stop(event);
    void models.removeProvider(providerId)
      .then(() => {
        onToggleExpanded(providerId, false);
        onChanged();
        models.notify(t('settings.modelsTab.removedProvider', { name: displayName }));
      })
      .catch((cause: unknown) => { onError(cause instanceof Error ? cause.message : t('common.error')); });
  };

  const toggleModel = (modelValue: string, checked: boolean): void => {
    const visible = new Set(settings.visibleModels);
    if (checked) visible.add(modelValue);
    else visible.delete(modelValue);
    void save({ visibleModels: [...visible] }).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const testProvider = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await models.testProvider(providerId);
      models.notify(
        result.ok
          ? t('settings.modelsTab.testReady', { name: displayName, detail: result.detail })
          : t('settings.modelsTab.testFailed', { name: displayName, detail: result.detail }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      onError(t('settings.modelsTab.testError', { name: displayName, message }));
    } finally {
      setTesting(false);
    }
  };

  const codexConnected = isCodex && models.hasCodexAuth();

  return (
    <details className={`pivi-provider-card${disabled ? ' pivi-provider-card-disabled' : ''}`} open={expanded}>
      <summary
        className="pivi-provider-header"
        onClick={event => { event.preventDefault(); onToggleExpanded(providerId); }}
      >
        <div className="pivi-provider-title-row">
          {logoSlug ? <ProviderLogo slug={logoSlug} size={18} className="pivi-provider-card-logo" /> : null}
          <span className="pivi-provider-title">{displayName}</span>
        </div>
        <span
          className={`pivi-provider-status ${readiness}`}
          title={t(STATUS_DESC_KEYS[readiness])}
        >
          {t(STATUS_LABEL_KEYS[readiness])}
        </span>
        <button className="pivi-provider-disable-btn" type="button" onClick={toggleDisabled}>
          {disabled ? t('common.enable') : t('common.disable')}
        </button>
        <button className="pivi-provider-remove-btn" type="button" onClick={remove}>
          {t('common.remove')}
        </button>
      </summary>
      <div className="pivi-provider-body">
        {custom ? (
          <>
            <CustomProviderPanel models={models} config={custom} onChanged={onChanged} onError={onError} />
            <ProviderCredentials models={models} providerId={providerId} allowKeyless={allowKeyless} onChanged={onChanged} onError={onError} />
          </>
        ) : isCodex ? (
          <CodexSection models={models} connected={codexConnected} onChanged={onChanged} onError={onError} />
        ) : (
          <ProviderCredentials models={models} providerId={providerId} allowKeyless={allowKeyless} onChanged={onChanged} onError={onError} />
        )}
        <ModelChecklist catalog={catalog} providerId={providerId} settings={settings} onToggleModel={toggleModel} />
        <button
          className="pivi-provider-test-btn"
          type="button"
          disabled={testing}
          onClick={() => { void testProvider(); }}
        >
          {testing ? t('settings.modelsTab.testing') : t('settings.modelsTab.testProvider')}
        </button>
      </div>
    </details>
  );
}
