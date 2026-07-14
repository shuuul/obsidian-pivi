import { useState } from 'react';

import { useT } from '../../i18n';
import { useHostTerminology } from '../../platform';
import type { SettingsModelsPort } from '../../ports';
import { SettingHeading, SettingRow } from '../controls';

export interface ProviderCredentialsProps {
  readonly models: SettingsModelsPort;
  readonly providerId: string;
  readonly allowKeyless: boolean;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}

/** API-key / OAuth-token credential inputs for one provider card body. */
export function ProviderCredentials({ models, providerId, allowKeyless, onChanged, onError }: ProviderCredentialsProps) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const env = models.getProviderEnvInfo(providerId);
  const credentialKind = models.getCredentialKind(providerId);
  const secretId = models.getSecretId(providerId);
  const apiKeyStored = credentialKind === 'api_key';
  const oauthStored = credentialKind === 'oauth';

  const [authType, setAuthType] = useState<'api' | 'oauth'>(oauthStored ? 'oauth' : 'api');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [oauthInput, setOauthInput] = useState('');
  const [pending, setPending] = useState(false);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setPending(true);
    try {
      await fn();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingHeading>
        {allowKeyless ? t('settings.modelsTab.authHeadingOptional') : t('settings.modelsTab.authHeading')}
      </SettingHeading>
      {env.oauthVar ? (
        <div className="pivi-auth-toggle-wrapper">
          <button
            className={`pivi-auth-toggle-btn${authType === 'api' ? ' active' : ''}`}
            type="button"
            onClick={() => setAuthType('api')}
          >
            {t('settings.modelsTab.apiKey')}
          </button>
          <button
            className={`pivi-auth-toggle-btn${authType === 'oauth' ? ' active' : ''}`}
            type="button"
            onClick={() => setAuthType('oauth')}
          >
            {t('settings.modelsTab.oauthToken')}
          </button>
        </div>
      ) : null}
      {authType === 'api' ? (
        <div className="pivi-cred-row pivi-setting-stack">
          <SettingRow
            name={t('settings.modelsTab.apiKey')}
            description={t(allowKeyless ? 'settings.modelsTab.apiKeyOptionalDesc' : 'settings.modelsTab.apiKeyDesc', { secretId, secureStorageName })}
          >
            <input
              type="text"
              value={apiKeyInput}
              placeholder={
                apiKeyStored
                  ? t('settings.modelsTab.apiKeySavedPlaceholder', { secureStorageName })
                  : allowKeyless
                    ? t('settings.modelsTab.apiKeyOptionalPlaceholder')
                    : t('settings.modelsTab.apiKeyPlaceholder')
              }
              onChange={event => setApiKeyInput(event.target.value)}
            />
            <button
              type="button"
              disabled={pending || !apiKeyInput.trim()}
              onClick={() => { void run(async () => { await models.setApiKey(providerId, apiKeyInput.trim()); setApiKeyInput(''); }); }}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              disabled={pending || !apiKeyStored}
              onClick={() => { void run(() => models.clearCredential(providerId)); }}
            >
              {t('settings.modelsTab.clear')}
            </button>
          </SettingRow>
        </div>
      ) : null}
      {authType === 'oauth' && env.oauthVar ? (
        <div className="pivi-cred-row pivi-setting-stack">
          <SettingRow
            name={t('settings.modelsTab.oauthToken')}
            description={t('settings.modelsTab.oauthTokenDesc', { secretId, secureStorageName })}
          >
            <input
              type="text"
              value={oauthInput}
              placeholder={oauthStored ? t('settings.modelsTab.oauthTokenSavedPlaceholder', { secureStorageName }) : t('settings.modelsTab.oauthTokenPlaceholder')}
              onChange={event => setOauthInput(event.target.value)}
            />
            <button
              type="button"
              disabled={pending || !oauthInput.trim()}
              onClick={() => { void run(async () => { await models.setOauthToken(providerId, oauthInput.trim()); setOauthInput(''); }); }}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              disabled={pending || !oauthStored}
              onClick={() => { void run(() => models.clearCredential(providerId)); }}
            >
              {t('settings.modelsTab.clear')}
            </button>
          </SettingRow>
        </div>
      ) : null}
    </>
  );
}
