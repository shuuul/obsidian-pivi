import {
  isProviderOAuthLoginCancelled,
  type ProviderOAuthProgress,
} from '@pivi/pivi-agent-core/auth/providerOAuthProgress';
import { useCallback, useState } from 'react';

import { useT } from '../../i18n';
import { useHostTerminology } from '../../platform';
import type { SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import { SettingRow } from '../controls';
import { getProviderOAuthSettingsKeys, OAUTH_COMMON_SETTINGS_KEYS } from './providerOAuthI18n';

export interface ProviderOAuthSectionProps {
  readonly models: SettingsModelsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly providerId: string;
  readonly connected: boolean;
  readonly onChanged: () => void;
}

/** Interactive OAuth connect/disconnect controls for a built-in provider. */
export function ProviderOAuthSection({
  models,
  feedback,
  providerId,
  connected,
  onChanged,
}: ProviderOAuthSectionProps) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const [pending, setPending] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const keys = getProviderOAuthSettingsKeys(providerId);

  const handleProgress = useCallback((progress: ProviderOAuthProgress) => {
    switch (progress.kind) {
      case 'message':
        feedback.notify(progress.message);
        break;
      case 'device_code':
        setDeviceCode(progress.userCode);
        break;
      case 'cleared':
        setDeviceCode(null);
        break;
      default:
        break;
    }
  }, [feedback]);

  const connect = async (): Promise<void> => {
    setPending(true);
    setDeviceCode(null);
    try {
      await models.loginProviderOAuth(providerId, handleProgress);
      feedback.notify(t(keys.connected));
      onChanged();
    } catch (cause) {
      if (isProviderOAuthLoginCancelled(cause)) {
        feedback.notify(t(OAUTH_COMMON_SETTINGS_KEYS.cancelled));
      } else {
        const message = cause instanceof Error ? cause.message : t('common.error');
        feedback.notify(t(keys.loginFailed, { message }));
      }
    } finally {
      setPending(false);
      setDeviceCode(null);
    }
  };

  const disconnect = async (): Promise<void> => {
    setPending(true);
    try {
      await models.logoutProviderOAuth(providerId);
      feedback.notify(t(keys.disconnected));
      onChanged();
    } catch (cause) {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      setPending(false);
    }
  };

  const cancel = (): void => {
    models.cancelProviderOAuthLogin(providerId);
  };

  return (
    <div className="pivi-provider-oauth-setting pivi-setting-stack">
      <SettingRow name={t(keys.name)} description={t(keys.desc, { secureStorageName })}>
        <div className="pivi-provider-oauth-toolbar">
          <div className="pivi-provider-oauth-actions">
            <button type="button" disabled={pending} onClick={() => { void connect(); }}>
              {connected ? t(keys.reconnect) : t(keys.connect)}
            </button>
            <button type="button" disabled={pending || !connected} onClick={() => { void disconnect(); }}>
              {t(keys.disconnect)}
            </button>
            <button type="button" disabled={!pending} onClick={cancel}>
              {t(OAUTH_COMMON_SETTINGS_KEYS.cancel)}
            </button>
          </div>
          {deviceCode ? (
            <div className="pivi-provider-oauth-code" aria-live="polite">
              <span className="pivi-provider-oauth-code__label">{t(OAUTH_COMMON_SETTINGS_KEYS.deviceCode)}</span>
              <code className="pivi-provider-oauth-code__value">{deviceCode}</code>
            </div>
          ) : null}
        </div>
      </SettingRow>
    </div>
  );
}
