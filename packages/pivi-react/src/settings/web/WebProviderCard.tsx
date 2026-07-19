import type { WebProviderId } from '@pivi/pivi-agent-core/foundation/settings';
import {
  type CSSProperties,
  Fragment,
  type PointerEvent,
  useState,
} from 'react';

import { useT } from '../../i18n';
import { ProviderLogo } from '../../icons';
import type { SettingsPorts, SettingsWebProviderSnapshot } from '../../ports';
import type { SortableReorderHandleProps } from '../../reorder/useSortableReorder';

const MASKED_KEY = '••••••••';

const PROVIDER_LABELS: Record<WebProviderId, string> = {
  brave: 'Brave Search',
  tavily: 'Tavily',
  exa: 'Exa',
  anysearch: 'AnySearch',
};

export interface WebProviderCardProps {
  readonly provider: SettingsWebProviderSnapshot;
  readonly position: number;
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly pending: boolean;
  readonly dragging: boolean;
  readonly dragOffset: number;
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
  const label = PROVIDER_LABELS[provider.id];
  const status = disabled
    ? t('settings.webSearch.status.disabled')
    : credentialConfigured
      ? t('settings.webSearch.status.configured')
      : provider.apiKeyRequired
        ? t('settings.webSearch.status.missingKey')
        : t('settings.webSearch.status.anonymous');

  const saveKey = async (): Promise<void> => {
    const value = key.trim();
    if (!value || value === MASKED_KEY) return;
    setSavingKey(true);
    try {
      ports.complex.webSearch.writeCredential(provider.id, value);
      setKey(MASKED_KEY);
      setStoredCredential(true);
      setCredentialConfigured(true);
      await ports.complex.runtime.refreshPrompt();
    } catch {
      props.onError();
    } finally {
      setSavingKey(false);
    }
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

  const style = dragging
    ? { '--pivi-provider-drag-y': `${dragOffset}px` } as CSSProperties
    : undefined;
  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    props.reorderHandleProps.onPointerDown(event);
  };

  return <Fragment>
    <details
      className={`pivi-provider-card pivi-sortable-provider-card pivi-web-provider-card${disabled ? ' pivi-provider-card-disabled' : ''}${dragging ? ' is-dragging' : ''}`}
      data-provider-sort-id={provider.id}
      open={expanded}
      style={style}
    >
      <summary
        className="pivi-provider-header pivi-web-provider-header"
        onClick={(event) => {
          event.preventDefault();
          if (!props.suppressReorderClick()) props.onToggleExpanded();
        }}
        onPointerCancel={props.reorderHandleProps.onPointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={props.reorderHandleProps.onPointerMove}
        onPointerUp={props.reorderHandleProps.onPointerUp}
      >
        <button
          type="button"
          className="pivi-provider-drag-handle"
          aria-label={t('settings.webSearch.reorder.handle', { provider: label, position })}
          aria-pressed={dragging}
          onClick={event => { event.preventDefault(); event.stopPropagation(); }}
          onKeyDown={props.reorderHandleProps.onKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <span className="pivi-provider-priority" aria-hidden="true">{position}</span>
        <div className="pivi-provider-title-row">
          <ProviderLogo slug={provider.id} size={18} className="pivi-provider-card-logo" />
          <span className="pivi-provider-title">{label}</span>
          <span className="pivi-web-provider-capabilities">
            {provider.search ? <span>{t('settings.webSearch.capability.search')}</span> : null}
            {provider.fetch ? <span>{t('settings.webSearch.capability.fetch')}</span> : null}
          </span>
        </div>
        <span className={`pivi-provider-status ${disabled ? 'disabled' : credentialConfigured ? 'configured' : 'missing'}`}>
          {status}
        </span>
        <button
          className="pivi-provider-disable-btn"
          type="button"
          disabled={pending}
          onClick={event => { event.preventDefault(); event.stopPropagation(); props.onToggleDisabled(); }}
        >
          {disabled ? t('common.enable') : t('common.disable')}
        </button>
      </summary>
      <div className="pivi-provider-body pivi-web-provider-body">
        <p className="pivi-setting-description">
          {provider.apiKeyRequired
            ? t('settings.webSearch.providerKeyRequired', { provider: label })
            : t('settings.webSearch.providerKeyOptional', { provider: label })}
        </p>
        <div className="pivi-web-provider-key-row">
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
            onBlur={() => { void saveKey(); }}
          />
          <button
            type="button"
            disabled={savingKey || !storedCredential}
            onClick={() => { void clearKey(); }}
          >
            {t('settings.webSearch.removeKey')}
          </button>
        </div>
      </div>
    </details>
  </Fragment>;
}
