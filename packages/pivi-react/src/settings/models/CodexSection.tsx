import { useState } from 'react';

import { useT } from '../../i18n';
import { useHostTerminology } from '../../platform';
import type { SettingsModelsPort } from '../../ports';
import { SettingRow } from '../controls';

export interface CodexSectionProps {
  readonly models: SettingsModelsPort;
  readonly connected: boolean;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}

/** OpenAI Codex subscription connect/disconnect controls. */
export function CodexSection({ models, connected, onChanged, onError }: CodexSectionProps) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const [pending, setPending] = useState(false);

  const connect = async (): Promise<void> => {
    setPending(true);
    try {
      await models.loginCodex(message => models.notify(message));
      models.notify(t('settings.modelsTab.codex.connected'));
      onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      onError(t('settings.modelsTab.codex.loginFailed', { message }));
    } finally {
      setPending(false);
    }
  };

  const disconnect = (): void => {
    try {
      models.logoutCodex();
      models.notify(t('settings.modelsTab.codex.disconnected'));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('common.error'));
    }
  };

  return (
    <div className="pivi-codex-setting pivi-setting-stack">
      <SettingRow name={t('settings.modelsTab.codex.name')} description={t('settings.modelsTab.codex.desc', { secureStorageName })}>
        <button type="button" disabled={pending} onClick={() => { void connect(); }}>
          {connected ? t('settings.modelsTab.codex.reconnect') : t('settings.modelsTab.codex.connect')}
        </button>
        <button type="button" disabled={pending || !connected} onClick={disconnect}>
          {t('settings.modelsTab.codex.disconnect')}
        </button>
      </SettingRow>
    </div>
  );
}
