import type { CustomProviderConfig } from '@pivi/agent/foundation/customProviders';
import type { PiAgentSettingsView } from '@pivi/agent/foundation/settingsModelKey';
import { useState } from 'react';

import { useT } from '../../i18n';
import type { SettingsCatalogPort } from '../../ports';
import { SettingsSectionHeading } from '../controls';

export interface ModelChecklistProps {
  readonly catalog: SettingsCatalogPort;
  readonly providerId: string;
  readonly settings: PiAgentSettingsView;
  readonly onToggleModel: (modelValue: string, checked: boolean) => void;
  /** Present for custom/local providers; enables the per-model catalog-id field. */
  readonly customProvider?: CustomProviderConfig;
  readonly onPatchModelCatalogId?: (modelId: string, catalogModelId: string) => void;
  readonly onPatchModelMaxTokensOverride?: (modelId: string, maxTokensOverride: number | null) => void;
}

interface ModelCatalogIdInputProps {
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly description: string;
  readonly onCommit: (catalogModelId: string) => void;
}

/** Draft-commit text field for the user-declared built-in catalog model id. */
function ModelCatalogIdInput({
  value,
  placeholder,
  ariaLabel,
  description,
  onCommit,
}: ModelCatalogIdInputProps) {
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    const next = draft.trim();
    if (next !== value) {
      onCommit(next);
    }
  };
  return (
    <input
      className="pivi-settings-control pivi-model-catalog-id-input"
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={description}
      onChange={event => { setDraft(event.target.value); }}
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

interface ModelMaxTokensOverrideInputProps {
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly description: string;
  readonly onCommit: (maxTokensOverride: number | null) => void;
}

function parseMaxTokensOverrideDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

/** Draft-commit number field for a user-declared per-response output cap. */
function ModelMaxTokensOverrideInput({
  value,
  placeholder,
  ariaLabel,
  description,
  onCommit,
}: ModelMaxTokensOverrideInputProps) {
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    const next = parseMaxTokensOverrideDraft(draft);
    const current = parseMaxTokensOverrideDraft(value);
    const nextDraft = next === null ? '' : String(next);
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    if (next !== current) {
      onCommit(next);
    }
  };
  return (
    <input
      className="pivi-settings-control pivi-model-catalog-id-input"
      type="text"
      inputMode="numeric"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={description}
      onChange={event => { setDraft(event.target.value); }}
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

/** Candidate-model checkbox grid for one provider card body. */
export function ModelChecklist({
  catalog,
  providerId,
  settings,
  onToggleModel,
  customProvider,
  onPatchModelCatalogId,
  onPatchModelMaxTokensOverride,
}: ModelChecklistProps) {
  const t = useT();
  const providerModels = catalog.listModelsForProvider(providerId);
  const showCatalogId = !!customProvider && !!onPatchModelCatalogId;
  const showMaxTokensOverride = !!customProvider && !!onPatchModelMaxTokensOverride;
  return (
    <>
      <SettingsSectionHeading level={3}>{t('settings.modelsTab.candidateModels')}</SettingsSectionHeading>
      <div className="pivi-models-checklist-grid">
        {providerModels.length === 0 ? (
          <div className="pivi-no-models-message">{t('settings.modelsTab.noModels')}</div>
        ) : (
          providerModels.map(model => {
            const inputId = `checkbox-${providerId}-${model.value}`.replace(/[^a-zA-Z0-9_-]/g, '-');
            const checked = settings.visibleModels.includes(model.value);
            const modelDef = customProvider?.models.find(
              def => `${customProvider.id}/${def.id}` === model.value,
            );
            const catalogModelId = modelDef?.catalogModelId ?? '';
            const maxTokensOverride = modelDef?.maxTokensOverride
              ? String(modelDef.maxTokensOverride)
              : '';
            return (
              <div className="pivi-model-checkbox-wrapper" key={model.value}>
                <input
                  id={inputId}
                  className="pivi-model-checkbox"
                  type="checkbox"
                  checked={checked}
                  onChange={event => onToggleModel(model.value, event.target.checked)}
                />
                <label className="pivi-model-checkbox-label" htmlFor={inputId}>
                  <span className="pivi-model-checkbox-title">{model.label}</span>
                  {model.description ? <span className="pivi-model-checkbox-desc">{model.description}</span> : null}
                  {showCatalogId && modelDef ? (
                    <ModelCatalogIdInput
                      key={`${model.value} catalog ${catalogModelId}`}
                      value={catalogModelId}
                      placeholder={t('settings.modelsTab.catalogModelIdPlaceholder')}
                      ariaLabel={t('settings.modelsTab.catalogModelIdAria', { name: model.label })}
                      description={t('settings.modelsTab.catalogModelIdDesc')}
                      onCommit={next => { onPatchModelCatalogId(modelDef.id, next); }}
                    />
                  ) : null}
                  {showMaxTokensOverride && modelDef ? (
                    <ModelMaxTokensOverrideInput
                      key={`${model.value} maxTokens ${maxTokensOverride}`}
                      value={maxTokensOverride}
                      placeholder={t('settings.modelsTab.maxTokensOverridePlaceholder')}
                      ariaLabel={t('settings.modelsTab.maxTokensOverrideAria', { name: model.label })}
                      description={t('settings.modelsTab.maxTokensOverrideDesc')}
                      onCommit={next => { onPatchModelMaxTokensOverride(modelDef.id, next); }}
                    />
                  ) : null}
                </label>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
