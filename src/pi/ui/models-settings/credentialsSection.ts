import { Setting } from 'obsidian';

import type { ProviderEnvVarNames } from '../../auth/providerEnvVars';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  setProviderCredentialSecret,
} from '../../auth/ProviderSecretStorage';
import { setEnvVarValue } from './envVarHelpers';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderProviderCredentialsSection(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providerId: string,
  info: ProviderEnvVarNames,
  updateStatusBadge: () => void,
): void {
  new Setting(body).setName('Authentication & credentials').setHeading();

  const apiKeyInKeychain = !!getProviderCredentialSecret(state.secretStorage, providerId, 'api-key');
  const oauthInKeychain = info.oauthVar
    ? !!getProviderCredentialSecret(state.secretStorage, providerId, 'oauth-token')
    : false;

  let activeAuthType: 'api' | 'oauth' = oauthInKeychain ? 'oauth' : 'api';

  const authToggleWrapper = body.createDiv({ cls: 'obsius2-auth-toggle-wrapper obsius2-hidden' });
  if (info.oauthVar) {
    authToggleWrapper.removeClass('obsius2-hidden');
    const apiBtn = authToggleWrapper.createEl('button', {
      cls: `obsius2-auth-toggle-btn ${activeAuthType === 'api' ? 'active' : ''}`,
      text: 'API key',
    });
    const oauthBtn = authToggleWrapper.createEl('button', {
      cls: `obsius2-auth-toggle-btn ${activeAuthType === 'oauth' ? 'active' : ''}`,
      text: 'OAUTH token',
    });

    apiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      activeAuthType = 'api';
      apiBtn.addClass('active');
      oauthBtn.removeClass('active');
      apiInputRow.removeClass('obsius2-hidden');
      oauthInputRow.addClass('obsius2-hidden');
    });

    oauthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      activeAuthType = 'oauth';
      oauthBtn.addClass('active');
      apiBtn.removeClass('active');
      oauthInputRow.removeClass('obsius2-hidden');
      apiInputRow.addClass('obsius2-hidden');
    });
  }

  const apiInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'oauth' ? 'obsius2-hidden' : ''}` });
  new Setting(apiInputRow)
    .setName('API key')
    .setDesc(`Saved in Obsidian keychain as ${getProviderCredentialSecretId(providerId, 'api-key')}.`)
    .addText((text) => {
      text
        .setPlaceholder(
          apiKeyInKeychain ? 'Saved in keychain (enter to replace)' : 'Enter API key...',
        )
        .setValue('')
        .onChange(async (val) => {
          if (!val.trim()) {
            return;
          }
          setProviderCredentialSecret(state.secretStorage, providerId, 'api-key', val);
          const updatedEnv = setEnvVarValue(state.piSettings.environmentVariables, info.apiKeyVar, '');
          state.updatePiSettings({ environmentVariables: updatedEnv });
          await context.plugin.saveSettings();
          text.setValue('');
          updateStatusBadge();
        });
      text.inputEl.type = 'password';
    })
    .addButton((btn) => {
      btn
        .setButtonText('Clear')
        .setDisabled(!apiKeyInKeychain)
        .onClick(async () => {
          setProviderCredentialSecret(state.secretStorage, providerId, 'api-key', '');
          updateStatusBadge();
        });
    });

  const oauthInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'api' ? 'obsius2-hidden' : ''}` });
  if (info.oauthVar) {
    new Setting(oauthInputRow)
      .setName('OAUTH token')
      .setDesc(
        `Saved in Obsidian keychain as ${getProviderCredentialSecretId(providerId, 'oauth-token')}.`,
      )
      .addText((text) => {
        text
          .setPlaceholder(
            oauthInKeychain ? 'Saved in keychain (enter to replace)' : 'Enter OAUTH token...',
          )
          .setValue('')
          .onChange(async (val) => {
            if (!val.trim()) {
              return;
            }
            setProviderCredentialSecret(state.secretStorage, providerId, 'oauth-token', val);
            const updatedEnv = setEnvVarValue(
              state.piSettings.environmentVariables,
              info.oauthVar!,
              '',
            );
            state.updatePiSettings({ environmentVariables: updatedEnv });
            await context.plugin.saveSettings();
            text.setValue('');
            updateStatusBadge();
          });
        text.inputEl.type = 'password';
      })
      .addButton((btn) => {
        btn
          .setButtonText('Clear')
          .setDisabled(!oauthInKeychain)
          .onClick(async () => {
            setProviderCredentialSecret(state.secretStorage, providerId, 'oauth-token', '');
            updateStatusBadge();
          });
      });
  }
}
