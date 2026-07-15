import type { CustomProviderConfig } from '@pivi/pivi-agent-core/foundation/customProviders';
import { useState } from 'react';

import { useT } from '../../i18n';
import type { SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import { SettingRow, SettingsSectionHeading } from '../controls';

export interface CustomProviderPanelProps {
  readonly models: SettingsModelsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly config: CustomProviderConfig;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}

/** Display-name / base-URL / fetch-models controls for a custom or local endpoint. */
export function CustomProviderPanel({ models, feedback, config, onChanged, onError }: CustomProviderPanelProps) {
  const t = useT();
  const [name, setName] = useState(config.name);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [fetching, setFetching] = useState(false);

  const patch = (value: { name?: string; baseUrl?: string }): void => {
    void models.patchCustomProvider(config.id, value).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const fetchModels = async (): Promise<void> => {
    setFetching(true);
    try {
      const result = await models.fetchCustomProviderModels(config.id);
      onChanged();
      feedback.notify(t('settings.modelsTab.fetchModelsSuccess', { name: config.name, count: String(result.count) }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      feedback.notify(t('settings.modelsTab.fetchModelsFailed', { name: config.name, message }));
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <SettingsSectionHeading level={3}>{t('settings.modelsTab.endpointHeading')}</SettingsSectionHeading>
      <SettingRow name={t('settings.modelsTab.displayName')} description={t('settings.modelsTab.displayNameDesc')}>
        <input
          className="pivi-settings-control"
          type="text"
          value={name}
          onChange={event => {
            const next = event.target.value;
            setName(next);
            patch({ name: next.trim() || config.name });
          }}
        />
      </SettingRow>
      <SettingRow name={t('settings.modelsTab.baseUrl')} description={t('settings.modelsTab.baseUrlDesc')}>
        <input
          className="pivi-settings-control"
          type="text"
          value={baseUrl}
          placeholder={t('settings.modelsTab.baseUrlPlaceholder')}
          onChange={event => {
            const next = event.target.value;
            setBaseUrl(next);
            patch({ baseUrl: next.trim() });
          }}
        />
      </SettingRow>
      <div className="pivi-custom-provider-actions">
        <button
          className="pivi-provider-fetch-models-btn"
          type="button"
          disabled={fetching}
          onClick={() => { void fetchModels(); }}
        >
          {fetching ? t('settings.modelsTab.fetchingModels') : t('settings.modelsTab.fetchModels')}
        </button>
      </div>
    </>
  );
}
