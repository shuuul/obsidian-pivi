import type { ChatUIOption } from '@pivi/agent/runtime/chatUi';
import type {
  CustomProviderConfig,
  CustomProviderThinkingFormat,
} from '@pivi/agent/settings/customProviders';
import type { PiAgentSettingsView } from '@pivi/agent/settings/modelKey';
import { useId, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n';
import type { SettingsCatalogPort } from '../../ports';
import { Select, SettingRow, SettingsSection } from '../primitives';
import { matchCatalogModels } from './catalogModelMatching';

export interface ModelChecklistProps {
  readonly catalog: SettingsCatalogPort;
  readonly providerId: string;
  readonly settings: PiAgentSettingsView;
  readonly onToggleModel: (modelValue: string, checked: boolean) => void;
  /** Present for custom/local providers; enables the per-model catalog-id field. */
  readonly customProvider?: CustomProviderConfig;
  readonly onPatchModelCatalogId?: (modelId: string, catalogModelId: string) => void;
  readonly onPatchModelMaxTokensOverride?: (modelId: string, maxTokensOverride: number | null) => void;
  readonly getContextWindowOverride?: (modelKey: string) => number | null;
  readonly onPatchContextWindowOverride?: (modelKey: string, value: number | null) => void;
  readonly onPatchReasoningOverride?: (modelId: string, value: boolean | null) => void;
  readonly onPatchThinkingFormatOverride?: (
    modelId: string,
    value: CustomProviderThinkingFormat | null,
  ) => void;
}

interface ModelCatalogIdInputProps {
  readonly value: string;
  readonly providerModelName: string;
  readonly catalogModels: readonly ChatUIOption[];
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly description: string;
  readonly onCommit: (catalogModelId: string) => void;
}

/** Draft-commit text field for the user-declared built-in catalog model id. */
function ModelCatalogIdInput({
  value,
  providerModelName,
  catalogModels,
  placeholder,
  ariaLabel,
  description,
  onCommit,
}: ModelCatalogIdInputProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const lastCommittedRef = useRef(value);
  const listboxId = useId();
  const candidates = useMemo(
    () => open ? matchCatalogModels(catalogModels, draft, providerModelName) : [],
    [catalogModels, draft, open, providerModelName],
  );
  const commit = (candidate = draft): void => {
    const next = candidate.trim();
    if (next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onCommit(next);
    }
  };
  const choose = (index: number): void => {
    const candidate = candidates[index];
    if (!candidate) return;
    setDraft(candidate.value);
    setOpen(false);
    setActiveIndex(-1);
    commit(candidate.value);
  };
  return (
    <div className="pivi-model-catalog-combobox">
      <input
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="pivi-settings-control pivi-model-catalog-id-input"
        type="text"
        value={draft}
        placeholder={placeholder}
        role="combobox"
        title={description}
        onChange={event => {
          setDraft(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => { setOpen(true); }}
        onBlur={() => {
          commit();
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && candidates.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => Math.min(index + 1, candidates.length - 1));
          } else if (event.key === 'ArrowUp' && candidates.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => index <= 0 ? candidates.length - 1 : index - 1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (open && activeIndex >= 0) {
              choose(activeIndex);
            } else {
              commit();
              event.currentTarget.blur();
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
      />
      {open && candidates.length > 0 ? (
        <div className="pivi-model-catalog-options" id={listboxId} role="listbox">
          {candidates.map((candidate, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`pivi-model-catalog-option${index === activeIndex ? ' is-highlighted' : ''}`}
              id={`${listboxId}-option-${index}`}
              key={candidate.value}
              onClick={() => { choose(index); }}
              onMouseDown={event => { event.preventDefault(); }}
              onMouseEnter={() => { setActiveIndex(index); }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span className="pivi-model-catalog-option-name">{candidate.label}</span>
              <span className="pivi-model-catalog-option-id">{candidate.value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  getContextWindowOverride,
  onPatchContextWindowOverride,
  onPatchReasoningOverride,
  onPatchThinkingFormatOverride,
}: ModelChecklistProps) {
  const t = useT();
  const providerModels = catalog.listModelsForProvider(providerId);
  const showCatalogId = !!customProvider && !!onPatchModelCatalogId;
  const catalogModels = showCatalogId ? catalog.listCatalogModels() : [];
  const showMaxTokensOverride = !!customProvider && !!onPatchModelMaxTokensOverride;
  return (
    <SettingsSection title={t('settings.modelsTab.candidateModels')}>
      {providerModels.length === 0 ? (
        <p className="pivi-no-models-message">{t('settings.modelsTab.noModels')}</p>
      ) : (
        <div className="pivi-models-checklist-grid">
          {providerModels.map(model => {
        const inputId = `checkbox-${providerId}-${model.value}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const checked = settings.visibleModels.includes(model.value);
        const modelDef = customProvider?.models.find(
          def => `${customProvider.id}/${def.id}` === model.value,
        );
        const catalogModelId = modelDef?.catalogModelId ?? '';
        const maxTokensOverride = modelDef?.maxTokensOverride
          ? String(modelDef.maxTokensOverride)
          : '';
        const contextWindowOverride = getContextWindowOverride?.(model.value);
        const showCompatibilityOverrides = !!modelDef && (
          showMaxTokensOverride
          || !!onPatchContextWindowOverride
          || !!onPatchReasoningOverride
          || (customProvider?.api === 'openai-completions' && !!onPatchThinkingFormatOverride)
        );
        const extras = showCatalogId || showCompatibilityOverrides;
        return (
          <SettingRow
            key={model.value}
            stacked={extras}
            name={model.label}
            description={model.description}
          >
            <input
              id={inputId}
              className="pivi-model-checkbox"
              type="checkbox"
              checked={checked}
              onChange={event => onToggleModel(model.value, event.target.checked)}
            />
            {showCatalogId && modelDef ? (
              <ModelCatalogIdInput
                key={`${model.value} catalog ${catalogModelId}`}
                value={catalogModelId}
                providerModelName={modelDef.name}
                catalogModels={catalogModels}
                placeholder={t('settings.modelsTab.catalogModelIdPlaceholder')}
                ariaLabel={t('settings.modelsTab.catalogModelIdAria', { name: model.label })}
                description={t('settings.modelsTab.catalogModelIdDesc')}
                onCommit={next => { onPatchModelCatalogId(modelDef.id, next); }}
              />
            ) : null}
            {showCompatibilityOverrides ? (
              <details className="pivi-model-compatibility">
                <summary>{t('settings.modelsTab.advancedCompatibility')}</summary>
                <div className="pivi-model-compatibility-fields">
                  {modelDef && onPatchContextWindowOverride ? (
                    <label className="pivi-model-compatibility-field">
                      <span>{t('settings.modelsTab.contextWindowOverrideLabel')}</span>
                      <ModelMaxTokensOverrideInput
                        key={`${model.value} context ${contextWindowOverride ?? ''}`}
                        value={contextWindowOverride ? String(contextWindowOverride) : ''}
                        placeholder={t('settings.modelsTab.overrideAuto')}
                        ariaLabel={t('settings.modelsTab.contextWindowOverrideAria', { name: model.label })}
                        description={t('settings.modelsTab.contextWindowOverrideDesc')}
                        onCommit={next => onPatchContextWindowOverride(model.value, next)}
                      />
                    </label>
                  ) : null}
                  {showMaxTokensOverride && modelDef ? (
                    <label className="pivi-model-compatibility-field">
                      <span>{t('settings.modelsTab.maxTokensOverrideLabel')}</span>
                      <ModelMaxTokensOverrideInput
                        key={`${model.value} maxTokens ${maxTokensOverride}`}
                        value={maxTokensOverride}
                        placeholder={t('settings.modelsTab.overrideAuto')}
                        ariaLabel={t('settings.modelsTab.maxTokensOverrideAria', { name: model.label })}
                        description={t('settings.modelsTab.maxTokensOverrideDesc')}
                        onCommit={next => { onPatchModelMaxTokensOverride(modelDef.id, next); }}
                      />
                    </label>
                  ) : null}
                  {modelDef && onPatchReasoningOverride ? (
                    <label
                      className="pivi-model-compatibility-field"
                      title={t('settings.modelsTab.reasoningOverrideDesc')}
                    >
                      <span>{t('settings.modelsTab.reasoningOverrideLabel')}</span>
                      <Select
                        label={t('settings.modelsTab.reasoningOverrideAria', { name: model.label })}
                        value={modelDef.reasoningOverride === undefined
                          ? 'auto'
                          : modelDef.reasoningOverride ? 'enabled' : 'disabled'}
                        onChange={value => onPatchReasoningOverride(
                          modelDef.id,
                          value === 'auto' ? null : value === 'enabled',
                        )}
                      >
                        <option value="auto">{t('settings.modelsTab.overrideAuto')}</option>
                        <option value="enabled">{t('settings.modelsTab.overrideEnabled')}</option>
                        <option value="disabled">{t('settings.modelsTab.overrideDisabled')}</option>
                      </Select>
                    </label>
                  ) : null}
                  {modelDef && modelDef.reasoningOverride !== false
                    && customProvider?.api === 'openai-completions'
                    && onPatchThinkingFormatOverride ? (
                      <label
                        className="pivi-model-compatibility-field"
                        title={t('settings.modelsTab.thinkingFormatOverrideDesc')}
                      >
                        <span>{t('settings.modelsTab.thinkingFormatOverrideLabel')}</span>
                        <Select
                          label={t('settings.modelsTab.thinkingFormatOverrideAria', { name: model.label })}
                          value={modelDef.thinkingFormatOverride ?? 'auto'}
                          onChange={value => onPatchThinkingFormatOverride(
                            modelDef.id,
                            value === 'auto' ? null : value as CustomProviderThinkingFormat,
                          )}
                        >
                          <option value="auto">{t('settings.modelsTab.overrideAuto')}</option>
                          <option value="openai">OpenAI</option>
                          <option value="zai">Z.AI</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="qwen">Qwen</option>
                          <option value="qwen-chat-template">Qwen chat template</option>
                        </Select>
                      </label>
                    ) : null}
                </div>
              </details>
            ) : null}
          </SettingRow>
        );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
