import { isDualAuthOAuthProviderId } from '@pivi/agent/auth/piProviderCredentials';
import { isLocalCustomProviderKind } from '@pivi/agent/settings/customProviders';
import type { PiAgentSettingsView } from '@pivi/agent/settings/modelKey';
import { Fragment, type MouseEvent, useState } from 'react';

import { useT } from '../../i18n';
import { ProviderLogo } from '../../icons';
import { useHostTerminology } from '../../platform';
import type { SettingsCatalogPort, SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import type { SortableReorderHandleProps } from '../../reorder/useSortableReorder';
import { ModalLayer } from '../../shared/ModalLayer';
import { DisclosureCard, SettingsRemoveButton, Toggle } from '../primitives';
import { CustomProviderPanel } from './CustomProviderPanel';
import { ModelChecklist } from './ModelChecklist';
import { ProviderApiKeyField,ProviderCredentials } from './ProviderCredentials';
import { ProviderOAuthSection } from './ProviderOAuthSection';
import { STATUS_DESC_KEYS, STATUS_LABEL_KEYS } from './statusLabels';

export interface ProviderCardProps {
  readonly models: SettingsModelsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly catalog: SettingsCatalogPort;
  readonly providerId: string;
  readonly position: number;
  readonly settings: PiAgentSettingsView;
  readonly expanded: boolean;
  readonly pending: boolean;
  readonly dragging: boolean;
  readonly dragOffset: number;
  readonly reorderHandleProps: SortableReorderHandleProps<HTMLElement>;
  readonly suppressReorderClick: () => boolean;
  readonly onToggleExpanded: (providerId: string, open?: boolean) => void;
  readonly save: (patch: Parameters<SettingsModelsPort['saveSettings']>[0]) => Promise<void>;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
  readonly credentialCheckPending?: boolean;
}

/** One collapsible provider card in the models settings list. */
export function ProviderCard({
  models,
  feedback,
  catalog,
  providerId,
  position,
  settings,
  expanded,
  pending,
  dragging,
  dragOffset,
  reorderHandleProps,
  suppressReorderClick,
  onToggleExpanded,
  save,
  onChanged,
  onError,
  credentialCheckPending = false,
}: ProviderCardProps) {
  const t = useT();
  const terminology = useHostTerminology();
  const [testing, setTesting] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [deleteCredential, setDeleteCredential] = useState(false);
  const [removing, setRemoving] = useState(false);

  const custom = settings.customProviders.find(entry => entry.id === providerId);
  const displayName = custom?.name ?? models.getProviderDisplayName(providerId);
  const disabled = settings.disabledProviders.includes(providerId);
  const logoSlug = models.getProviderLogoSlug(providerId);
  const readiness = models.getReadiness(providerId);
  const enableBlocked = disabled && readiness !== 'ready';
  const allowKeyless = !!custom && custom.apiKeyRequired === false;
  const isLocalProvider = !!custom && isLocalCustomProviderKind(custom.kind);
  const isInteractiveOAuth = models.interactiveOAuthProviderIds.includes(providerId);
  const isCodex = providerId === models.codexProviderId;
  const isDualAuthOAuth = isDualAuthOAuthProviderId(providerId);
  const isAccountOAuth = isInteractiveOAuth && !isCodex && !isDualAuthOAuth;
  const hasLegacyApiKey = models.getCredentialKind(providerId) === 'api_key';

  const stop = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleDisabled = (checked: boolean): void => {
    const next = new Set(settings.disabledProviders);
    if (checked) next.delete(providerId);
    else next.add(providerId);
    void save({ disabledProviders: [...next] }).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const remove = (event: MouseEvent): void => {
    stop(event);
    setDeleteCredential(false);
    setConfirmingRemove(true);
  };

  const confirmRemove = (): void => {
    setRemoving(true);
    void models.removeProvider(providerId, deleteCredential)
      .then(() => {
        setConfirmingRemove(false);
        onToggleExpanded(providerId, false);
        onChanged();
        feedback.notify(t('settings.modelsTab.removedProvider', { name: displayName }));
      })
      .catch((cause: unknown) => { onError(cause instanceof Error ? cause.message : t('common.error')); })
      .finally(() => { setRemoving(false); });
  };

  const toggleModel = (modelValue: string, checked: boolean): void => {
    const visible = new Set(settings.visibleModels);
    if (checked) visible.add(modelValue);
    else visible.delete(modelValue);
    void save({ visibleModels: [...visible] }).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    });
  };

  const patchModelCatalogId = (modelId: string, catalogModelId: string): void => {
    void models.patchCustomProviderModel(providerId, modelId, { catalogModelId })
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const patchModelMaxTokensOverride = (modelId: string, maxTokensOverride: number | null): void => {
    void models.patchCustomProviderModel(providerId, modelId, { maxTokensOverride })
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const patchContextWindowOverride = (modelKey: string, value: number | null): void => {
    void models.patchContextWindowOverride(modelKey, value)
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const patchReasoningOverride = (modelId: string, reasoningOverride: boolean | null): void => {
    void models.patchCustomProviderModel(providerId, modelId, { reasoningOverride })
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const patchThinkingFormatOverride = (
    modelId: string,
    thinkingFormatOverride: Parameters<SettingsModelsPort['patchCustomProviderModel']>[2]['thinkingFormatOverride'],
  ): void => {
    void models.patchCustomProviderModel(providerId, modelId, { thinkingFormatOverride })
      .then(() => { onChanged(); })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const testProvider = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await models.testProvider(providerId);
      feedback.notify(
        result.ok
          ? t('settings.modelsTab.testReady', { name: displayName, detail: result.detail })
          : t('settings.modelsTab.testFailed', { name: displayName, detail: result.detail }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      feedback.notify(t('settings.modelsTab.testError', { name: displayName, message }));
    } finally {
      setTesting(false);
      onChanged();
    }
  };

  const oauthConnected = isInteractiveOAuth && models.hasProviderOAuth(providerId);
  const showCredentialCheck = credentialCheckPending && isInteractiveOAuth;

  return <Fragment>
    <DisclosureCard
      name={displayName}
      icon={logoSlug ? <ProviderLogo slug={logoSlug} size={18} /> : null}
      badges={(
        <span
          className={`pivi-provider-status${showCredentialCheck ? ' checking' : ` ${readiness}`}`}
          title={showCredentialCheck
            ? t('settings.modelsTab.statusDesc.checking')
            : t(STATUS_DESC_KEYS[readiness])}
        >
          {showCredentialCheck
            ? t('settings.modelsTab.status.checking')
            : t(STATUS_LABEL_KEYS[readiness])}
        </span>
      )}
      actions={(
        <>
          <Toggle
            checked={!disabled}
            disabled={pending || enableBlocked}
            label={disabled
              ? t('settings.modelsTab.enableAria', { name: displayName })
              : t('settings.modelsTab.disableAria', { name: displayName })}
            onChange={toggleDisabled}
          />
          <SettingsRemoveButton
            ariaLabel={t('settings.modelsTab.removeAria', { name: displayName })}
            onClick={remove}
          />
        </>
      )}
      open={expanded}
      onToggle={() => { onToggleExpanded(providerId); }}
      sortId={providerId}
      sortableHandleProps={pending ? undefined : reorderHandleProps}
      consumeClickAfterDrag={suppressReorderClick}
      dragging={dragging}
      dragOffset={dragOffset}
      reorderLabel={t('settings.webSearch.reorder.handle', { provider: displayName, position })}
    >
      {custom ? (
          <>
            <CustomProviderPanel models={models} feedback={feedback} config={custom} onChanged={onChanged} onError={onError} />
            {!isLocalProvider ? (
              <ProviderCredentials models={models} providerId={providerId} allowKeyless={allowKeyless} onChanged={onChanged} onError={onError} />
            ) : null}
            <ModelChecklist
              catalog={catalog}
              providerId={providerId}
              settings={settings}
              onToggleModel={toggleModel}
              customProvider={custom}
              onPatchModelCatalogId={patchModelCatalogId}
              onPatchModelMaxTokensOverride={patchModelMaxTokensOverride}
              getContextWindowOverride={modelKey => models.getContextWindowOverride(modelKey)}
              onPatchContextWindowOverride={patchContextWindowOverride}
              onPatchReasoningOverride={patchReasoningOverride}
              onPatchThinkingFormatOverride={patchThinkingFormatOverride}
            />
          </>
        ) : isCodex ? (
          <>
            <ProviderOAuthSection models={models} feedback={feedback} providerId={providerId} connected={oauthConnected} onChanged={onChanged} />
            <ModelChecklist catalog={catalog} providerId={providerId} settings={settings} onToggleModel={toggleModel} />
          </>
        ) : isAccountOAuth ? (
          <>
            <ProviderOAuthSection models={models} feedback={feedback} providerId={providerId} connected={oauthConnected} onChanged={onChanged} />
            <ModelChecklist catalog={catalog} providerId={providerId} settings={settings} onToggleModel={toggleModel} />
          </>
        ) : isDualAuthOAuth ? (
          <>
            <ProviderOAuthSection models={models} feedback={feedback} providerId={providerId} connected={oauthConnected} onChanged={onChanged} />
            {hasLegacyApiKey ? (
              <ProviderApiKeyField
                models={models}
                providerId={providerId}
                allowKeyless={false}
                onChanged={onChanged}
                onError={onError}
              />
            ) : null}
            <ModelChecklist catalog={catalog} providerId={providerId} settings={settings} onToggleModel={toggleModel} />
          </>
        ) : (
          <>
            <ProviderCredentials models={models} providerId={providerId} allowKeyless={allowKeyless} onChanged={onChanged} onError={onError} />
            <ModelChecklist catalog={catalog} providerId={providerId} settings={settings} onToggleModel={toggleModel} />
          </>
        )}
        <button
          type="button"
          disabled={testing}
          onClick={() => { void testProvider(); }}
        >
          {testing ? t('settings.modelsTab.testing') : t('settings.modelsTab.testProvider')}
        </button>
    </DisclosureCard>
    {confirmingRemove ? (
      <ModalLayer
        ariaLabel={t('settings.modelsTab.removeConfirmTitle', { name: displayName })}
        open
        onClose={() => { if (!removing) setConfirmingRemove(false); }}
      >
        <div className="pivi-modal">
          <div className="pivi-modal__title">
            {t('settings.modelsTab.removeConfirmTitle', { name: displayName })}
          </div>
          <p>{t('settings.modelsTab.removeConfirmDescription')}</p>
          <label>
            <input
              type="checkbox"
              checked={deleteCredential}
              disabled={removing}
              onChange={event => { setDeleteCredential(event.currentTarget.checked); }}
            />
            <span>{t('settings.modelsTab.removeCredential', {
              secureStorageName: terminology.secureStorageName,
            })}</span>
          </label>
          <div className="pivi-modal__actions">
            <button type="button" data-modal-cancel disabled={removing} onClick={() => { setConfirmingRemove(false); }}>
              {t('common.cancel')}
            </button>
            <button
              className="pivi-button--danger"
              type="button"
              disabled={removing}
              onClick={confirmRemove}
            >
              {t('common.remove')}
            </button>
          </div>
        </div>
      </ModalLayer>
    ) : null}
  </Fragment>;
}
