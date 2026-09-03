import type { WebProviderId } from '@pivi/agent/settings/types';
import { Fragment, useState } from 'react';

import type { TranslationKey } from '../../i18n';
import { useT } from '../../i18n';
import { ProviderLogo } from '../../icons';
import type { SettingsPorts, SettingsWebProviderSnapshot } from '../../ports';
import type { SortableReorderHandleProps } from '../../reorder/useSortableReorder';
import { ExternalSetupLink } from '../ExternalSetupLink';
import { DisclosureCard, SettingRow, Toggle } from '../primitives';
import { getWebProviderSetupLink } from '../providerSetupLinks';

const MASKED_KEY = '••••••••';

const PROVIDER_LABEL_KEYS: Record<WebProviderId, TranslationKey> = {
  brave: 'settings.webSearch.providers.brave',
  tavily: 'settings.webSearch.providers.tavily',
  exa: 'settings.webSearch.providers.exa',
  anysearch: 'settings.webSearch.providers.anysearch',
};

export interface WebProviderCardProps {
  readonly provider: SettingsWebProviderSnapshot;
  readonly position: number;
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly pending: boolean;
  readonly dragging: boolean;
  readonly dragOffset: number;
  readonly dropIndicatorEdge?: 'before' | 'after';
  readonly secureStorageName: string;
  readonly ports: SettingsPorts;
  readonly onToggleExpanded: () => void;
  readonly onToggleDisabled: () => void;
  readonly reorderHandleProps: SortableReorderHandleProps<HTMLElement>;
  readonly suppressReorderClick: () => boolean;
  readonly onError: () => void;
}

export function WebProviderCard(props: WebProviderCardProps) {
  const {
    provider,
    position,
    disabled,
    expanded,
    pending,
    dragging,
    dragOffset,
    secureStorageName,
    ports,
  } = props;
  const t = useT();
  const [key, setKey] = useState(provider.storedCredential ? MASKED_KEY : '');
  const [storedCredential, setStoredCredential] = useState(provider.storedCredential);
  const [credentialConfigured, setCredentialConfigured] = useState(provider.credentialConfigured);
  const [savingKey, setSavingKey] = useState(false);
  const label = t(PROVIDER_LABEL_KEYS[provider.id]);
  const setupLink = getWebProviderSetupLink(provider.id);
  const status = disabled
    ? t('settings.webSearch.status.disabled')
    : credentialConfigured
      ? t('settings.webSearch.status.configured')
      : provider.apiKeyRequired
        ? t('settings.webSearch.status.missingKey')
        : t('settings.webSearch.status.anonymous');
  const statusKind = disabled
    ? undefined
    : credentialConfigured
      ? 'is-configured'
      : provider.apiKeyRequired
        ? 'is-error'
        : undefined;

  const saveKey = async (): Promise<boolean> => {
    const value = key.trim();
    if (!value || value === MASKED_KEY) return true;
    setSavingKey(true);
    try {
      ports.complex.webSearch.writeCredential(provider.id, value);
      setKey(MASKED_KEY);
      setStoredCredential(true);
      setCredentialConfigured(true);
      await ports.complex.runtime.refreshPrompt();
      return true;
    } catch {
      props.onError();
      return false;
    } finally {
      setSavingKey(false);
    }
  };

  const saveAndClose = async (): Promise<void> => {
    if (await saveKey()) props.onToggleExpanded();
  };

  const clearKey = async (): Promise<void> => {
    setSavingKey(true);
    try {
      ports.complex.webSearch.clearCredential(provider.id);
      setKey('');
      setStoredCredential(false);
      setCredentialConfigured(provider.environmentCredential);
      await ports.complex.runtime.refreshPrompt();
    } catch {
      props.onError();
    } finally {
      setSavingKey(false);
    }
  };

  return <Fragment>
    <DisclosureCard
      name={label}
      icon={<ProviderLogo slug={provider.id} size={18} />}
      className={disabled ? 'is-disabled' : undefined}
      badges={(
        <>
          {provider.search ? <span className="pivi-settings-chip">{t('settings.webSearch.capability.search')}</span> : null}
          {provider.fetch ? <span className="pivi-settings-chip">{t('settings.webSearch.capability.fetch')}</span> : null}
          <span className={`pivi-settings-chip${statusKind ? ` ${statusKind}` : ''}`}>{status}</span>
        </>
      )}
      actions={(
        <Toggle
          checked={!disabled}
          disabled={pending}
          label={disabled
            ? t('settings.webSearch.enableAria', { provider: label })
            : t('settings.webSearch.disableAria', { provider: label })}
          onChange={() => { props.onToggleDisabled(); }}
        />
      )}
      open={expanded}
      onToggle={() => { props.onToggleExpanded(); }}
      sortId={provider.id}
      sortableHandleProps={pending ? undefined : props.reorderHandleProps}
      consumeClickAfterDrag={props.suppressReorderClick}
      dragging={dragging}
      dragOffset={dragOffset}
      dropIndicatorEdge={props.dropIndicatorEdge}
      reorderLabel={t('settings.webSearch.reorder.handle', { provider: label, position })}
      saveDisabled={savingKey}
      onSave={() => { void saveAndClose(); }}
      footerActions={(
        <button
          type="button"
          disabled={savingKey || !storedCredential}
          onClick={() => { void clearKey(); }}
        >
          {t('settings.webSearch.removeKey')}
        </button>
      )}
    >
      <SettingRow
        stacked
        name={t('settings.webSearch.apiKeyName', { provider: label })}
        description={(
          <>
            {provider.apiKeyRequired
              ? t('settings.webSearch.providerKeyRequired', { provider: label })
              : t('settings.webSearch.providerKeyOptional', { provider: label })}
            {setupLink ? (
              <>
                {' '}
                <ExternalSetupLink href={setupLink.href} kind={setupLink.kind} />
              </>
            ) : null}
          </>
        )}
      >
        <input
          className="pivi-settings-control pivi-settings-control--fill"
          type="password"
          value={key}
          placeholder={key === MASKED_KEY
            ? t('settings.webSearch.apiKeySavedPlaceholder', { secureStorageName })
            : t('settings.webSearch.apiKeyPlaceholder')}
          disabled={savingKey}
          aria-label={t('settings.webSearch.apiKeyName', { provider: label })}
          onFocus={() => { if (key === MASKED_KEY) setKey(''); }}
          onChange={event => { setKey(event.currentTarget.value); }}
        />
      </SettingRow>
    </DisclosureCard>
  </Fragment>;
}
