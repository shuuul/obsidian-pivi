import { useState } from 'react';

import { useT } from '../../i18n';
import { useHostTerminology } from '../../platform';
import type { SettingsFeedbackPort, SettingsModelsPort } from '../../ports';
import { SettingRow } from '../controls';

export interface CodexSectionProps {
  readonly models: SettingsModelsPort;
  readonly feedback: SettingsFeedbackPort;
  readonly connected: boolean;
  readonly onChanged: () => void;
}

/** OpenAI Codex subscription connect/disconnect controls. */
export function CodexSection({ models, feedback, connected, onChanged }: CodexSectionProps) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const [pending, setPending] = useState(false);

  const connect = async (): Promise<void> => {
    setPending(true);
    try {
      await models.loginCodex(message => feedback.notify(message));
      feedback.notify(t('settings.modelsTab.codex.connected'));
      onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error');
      feedback.notify(t('settings.modelsTab.codex.loginFailed', { message }));
    } finally {
      setPending(false);
    }
  };

  const disconnect = (): void => {
    try {
      models.logoutCodex();
      feedback.notify(t('settings.modelsTab.codex.disconnected'));
      onChanged();
    } catch (cause) {
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
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
