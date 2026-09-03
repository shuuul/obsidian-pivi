import {
  type CustomProviderConfig,
  isLocalCustomProviderKind,
  splitCustomProviderModelIdInputs,
} from '@pivi/agent/settings/customProviders';
import { useState } from 'react';

import { useT } from '../../i18n';
import type { SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import { BadgeListInput, SettingRow, SettingsSection } from '../controls';
import { ExternalSetupLink } from '../ExternalSetupLink';
import { getModelProviderSetupLink } from '../providerSetupLinks';
import { ProviderApiKeyField } from './ProviderCredentials';

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
  const setupLink = isLocalCustomProviderKind(config.kind)
    ? getModelProviderSetupLink(config.kind)
    : undefined;
  const modelIds = config.models.map(model => model.id);

  const patch = (value: { name?: string; baseUrl?: string }): void => {
    void models.patchCustomProvider(config.id, value)
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
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

  const addModelIds = async (values: readonly string[]): Promise<boolean> => {
    const added = splitCustomProviderModelIdInputs(values);
    if (added.length === 0) return false;
    const next = [...modelIds];
    const seen = new Set(next);
    let changed = false;
    for (const id of added) {
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      changed = true;
    }
    if (!changed) return false;
    try {
      await models.setCustomProviderModelIds(config.id, next);
      onChanged();
      return true;
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : t('common.error'));
      return false;
    }
  };

  const removeModelId = async (value: string): Promise<void> => {
    try {
      await models.setCustomProviderModelIds(
        config.id,
        modelIds.filter(id => id !== value),
      );
      onChanged();
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    }
  };

  return (
    <SettingsSection title={t('settings.modelsTab.endpointHeading')}>
      {setupLink ? (
        <p className="pivi-setting-description">
          <ExternalSetupLink href={setupLink.href} kind={setupLink.kind} />
        </p>
      ) : null}
      <div className="pivi-provider-endpoint-fields">
        <SettingRow name={t('settings.modelsTab.displayName')} description={t('settings.modelsTab.displayNameDesc')}>
          <input
            className="pivi-settings-control pivi-settings-control--fill"
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
            className="pivi-settings-control pivi-settings-control--fill"
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
      </div>
      {isLocalCustomProviderKind(config.kind) ? (
        <ProviderApiKeyField
          models={models}
          providerId={config.id}
          allowKeyless
          showOptionalLabel
          onChanged={onChanged}
          onError={onError}
        />
      ) : null}
      <SettingRow stacked name={t('settings.modelsTab.modelIds')} description={t('settings.modelsTab.modelIdsDesc')}>
        <BadgeListInput
          values={modelIds}
          placeholder={t('settings.modelsTab.modelIdsPlaceholder')}
          inputLabel={t('settings.modelsTab.modelIdsInput')}
          removeLabel={value => t('settings.modelsTab.removeModelId', { value })}
          onAdd={addModelIds}
          onRemove={removeModelId}
        />
        <button
          className="pivi-provider-fetch-models-btn"
          type="button"
          disabled={fetching}
          onClick={() => { void fetchModels(); }}
        >
          {fetching ? t('settings.modelsTab.fetchingModels') : t('settings.modelsTab.fetchModels')}
        </button>
      </SettingRow>
    </SettingsSection>
  );
}
