import { getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/auth/PiProviderCredentials';
import type { ProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { parseEnvironmentVariables } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import { Setting } from 'obsidian';

import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

const MASKED_SECRET_VALUE = '••••••••';

function setEnvVarValue(envStr: string, varName: string, value: string): string {
  const env = parseEnvironmentVariables(envStr);
  if (value.trim()) {
    env[varName] = value.trim();
  } else {
    delete env[varName];
  }
  return Object.entries(env)
    .map(([key, envValue]) => `${key}=${envValue}`)
    .join('\n');
}

function setMaskedValue(input: HTMLInputElement, hasSecret: boolean): void {
  input.type = 'text';
  input.value = hasSecret ? MASKED_SECRET_VALUE : '';
}

function clearMaskedValueOnEdit(input: HTMLInputElement): void {
  if (input.value === MASKED_SECRET_VALUE) {
    input.value = '';
  }
}

export function renderProviderCredentialsSection(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providerId: string,
  info: ProviderEnvVarNames,
  updateStatusBadge: () => void,
): void {
  new Setting(body).setName('Authentication & credentials').setHeading();

  const credentialStore = context.plugin.getPiWorkspace()?.credentialStore ?? null;
  const credential = credentialStore?.readSync(providerId);
  const apiKeyInKeychain = credential?.type === 'api-key';
  const oauthInKeychain = credential?.type === 'oauth';

  let activeAuthType: 'api' | 'oauth' = oauthInKeychain ? 'oauth' : 'api';

  const authToggleWrapper = body.createDiv({ cls: 'pivi-auth-toggle-wrapper pivi-hidden' });
  if (info.oauthVar) {
    authToggleWrapper.removeClass('pivi-hidden');
    const apiBtn = authToggleWrapper.createEl('button', {
      cls: `pivi-auth-toggle-btn ${activeAuthType === 'api' ? 'active' : ''}`,
      text: 'API key',
    });
    const oauthBtn = authToggleWrapper.createEl('button', {
      cls: `pivi-auth-toggle-btn ${activeAuthType === 'oauth' ? 'active' : ''}`,
      text: 'OAUTH token',
    });

    apiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      activeAuthType = 'api';
      apiBtn.addClass('active');
      oauthBtn.removeClass('active');
      apiInputRow.removeClass('pivi-hidden');
      oauthInputRow.addClass('pivi-hidden');
    });

    oauthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      activeAuthType = 'oauth';
      oauthBtn.addClass('active');
      apiBtn.removeClass('active');
      oauthInputRow.removeClass('pivi-hidden');
      apiInputRow.addClass('pivi-hidden');
    });
  }

  const apiInputRow = body.createDiv({ cls: `pivi-cred-row ${activeAuthType === 'oauth' ? 'pivi-hidden' : ''}` });
  new Setting(apiInputRow)
    .setName('API key')
    .setDesc(`Saved in Obsidian keychain as ${getPiAiCredentialSecretId(providerId)}.`)
    .addText((text) => {
      text
        .setDisabled(!credentialStore)
        .setPlaceholder(
          apiKeyInKeychain ? 'Saved in keychain' : 'Enter API key...',
        )
        .onChange(async (val) => {
          if (val === MASKED_SECRET_VALUE) {
            return;
          }
          if (!credentialStore) {
            return;
          }
          if (!val.trim()) {
            return;
          }
          await credentialStore.modify(providerId, () => Promise.resolve({ type: 'api-key', key: val.trim() }));
          const updatedEnv = setEnvVarValue(state.piSettings.environmentVariables, info.apiKeyVar, '');
          state.updatePiSettings({ environmentVariables: updatedEnv });
          await context.plugin.saveSettings();
          setMaskedValue(text.inputEl, true);
          updateStatusBadge();
        });
      setMaskedValue(text.inputEl, apiKeyInKeychain);
      text.inputEl.addEventListener('focus', () => clearMaskedValueOnEdit(text.inputEl));
    })
    .addButton((btn) => {
      btn
        .setButtonText('Clear')
        .setDisabled(!credentialStore || !apiKeyInKeychain)
        .onClick(() => {
          void (async () => {
            await credentialStore?.delete(providerId);
            updateStatusBadge();
            context.redisplay();
          })();
        });
    });

  const oauthInputRow = body.createDiv({ cls: `pivi-cred-row ${activeAuthType === 'api' ? 'pivi-hidden' : ''}` });
  if (info.oauthVar) {
    new Setting(oauthInputRow)
      .setName('OAUTH token')
      .setDesc(
        `Saved in Obsidian keychain as ${getPiAiCredentialSecretId(providerId)}.`,
      )
      .addText((text) => {
        text
          .setDisabled(!credentialStore)
          .setPlaceholder(
            oauthInKeychain ? 'Saved in keychain' : 'Enter OAUTH token...',
          )
          .onChange(async (val) => {
            if (val === MASKED_SECRET_VALUE) {
              return;
            }
            if (!credentialStore) {
              return;
            }
            if (!val.trim()) {
              return;
            }
            await credentialStore.modify(providerId, () => Promise.resolve({
              type: 'oauth',
              access: val.trim(),
              refresh: '',
              expires: Number.MAX_SAFE_INTEGER,
            }));
            const updatedEnv = setEnvVarValue(
              state.piSettings.environmentVariables,
              info.oauthVar!,
              '',
            );
            state.updatePiSettings({ environmentVariables: updatedEnv });
            await context.plugin.saveSettings();
            setMaskedValue(text.inputEl, true);
            updateStatusBadge();
          });
        setMaskedValue(text.inputEl, oauthInKeychain);
        text.inputEl.addEventListener('focus', () => clearMaskedValueOnEdit(text.inputEl));
      })
      .addButton((btn) => {
        btn
          .setButtonText('Clear')
          .setDisabled(!credentialStore || !oauthInKeychain)
          .onClick(() => {
            void (async () => {
              await credentialStore?.delete(providerId);
              updateStatusBadge();
              context.redisplay();
            })();
          });
      });
  }
}
