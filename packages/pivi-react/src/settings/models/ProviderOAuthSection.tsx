import { useState } from 'react';

import { useT } from '../../i18n';
import { useHostTerminology } from '../../platform';
import type { SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import { SettingRow } from '../controls';
import { getProviderOAuthSettingsKeys } from './providerOAuthI18n';

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
  const keys = getProviderOAuthSettingsKeys(providerId);

  const connect = async (): Promise<void> => {
    setPending(true);
    try {
      await models.loginProviderOAuth(providerId, message => feedback.notify(message));
      feedback.notify(t(keys.connected));
      onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      feedback.notify(t(keys.loginFailed, { message }));
    } finally {
      setPending(false);
    }
  };

  const disconnect = (): void => {
    try {
      models.logoutProviderOAuth(providerId);
      feedback.notify(t(keys.disconnected));
      onChanged();
    } catch (cause) {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    }
  };

  return (
    <div className="pivi-provider-oauth-setting pivi-setting-stack">
      <SettingRow name={t(keys.name)} description={t(keys.desc, { secureStorageName })}>
        <button type="button" disabled={pending} onClick={() => { void connect(); }}>
          {connected ? t(keys.reconnect) : t(keys.connect)}
        </button>
        <button type="button" disabled={pending || !connected} onClick={disconnect}>
          {t(keys.disconnect)}
        </button>
      </SettingRow>
    </div>
  );
}
