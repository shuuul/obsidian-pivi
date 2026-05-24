import { Notice, Setting } from 'obsidian';

import { PiAgentServices } from '../../core/agent/PiAgentServices';
import type ObsiusPlugin from '../../main';
import { appendProviderLogo, preloadProviderLogos } from '../../shared/providerLogo';
import { getProviderEnvVarNames } from '../auth/providerEnvVars';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  isProviderConfigured,
  isProviderDisabled,
  isSecretStorageAvailable,
  listProviderIdsWithKeychainSecrets,
  MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
  setProviderCredentialSecret,
  syncPiProvidersFromKeychain,
} from '../auth/ProviderSecretStorage';
import { parseEnvironmentVariables } from '../../utils/env';
import { maybeGetPiWorkspaceServices } from '../app/PiWorkspaceServices';
import { CODEX_OAUTH_PROVIDER_ID } from '../auth/ProviderOAuthService';
import { getPiAgentSettings, updatePiAgentSettings } from '../settings';
import { getPiAiModelsForProvider, PI_AI_MODELS_CACHE } from './PiChatUIConfig';
import { getProviderDisplayName, getProviderLogoSlug } from './providerLogos';

export function renderPiModelsSettingsSection(
  container: HTMLElement,
  context: {
    plugin: ObsiusPlugin;
    redisplay: () => void;
  },
): void {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const secretStorage = context.plugin.app.secretStorage;
    let piSettings = getPiAgentSettings(settingsBag);

    if (!isSecretStorageAvailable(secretStorage)) {
      const warn = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
      warn.createEl('p', {
        text: `Provider API keys require Obsidian ${MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN} or newer (Obsidian keychain / SecretStorage). Upgrade Obsidian to use keychain-backed credentials.`,
      });
    }

    const synced = isSecretStorageAvailable(secretStorage)
      ? syncPiProvidersFromKeychain(
      secretStorage,
      piSettings.addedProviders,
      piSettings.environmentVariables,
    )
      : {
        addedProviders: piSettings.addedProviders,
        environmentVariables: piSettings.environmentVariables,
        changed: false,
      };
    if (synced.changed) {
      piSettings = updatePiAgentSettings(settingsBag, {
        addedProviders: synced.addedProviders,
        environmentVariables: synced.environmentVariables,
      });
      void context.plugin.saveSettings();
    }

    const getDisplayName = (id: string): string => getProviderDisplayName(id);

    const getEnvVarValue = (envStr: string, varName: string): string => {
      const env = parseEnvironmentVariables(envStr);
      return env[varName] || '';
    };

    const setEnvVarValue = (envStr: string, varName: string, value: string): string => {
      const env = parseEnvironmentVariables(envStr);
      if (value.trim()) {
        env[varName] = value.trim();
      } else {
        delete env[varName];
      }
      return Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    };

    // Pi agent setup
    new Setting(container).setName('Pi agent setup').setHeading();

    new Setting(container)
      .setName('Test connection')
      .setDesc('Check whether the configured model API endpoint is reachable from this device.')
      .addButton((btn) => {
        btn.setButtonText('Test connection');
        btn.onClick(async () => {
          btn.setDisabled(true);
          const previousLabel = btn.buttonEl.textContent ?? 'Test connection';
          btn.setButtonText('Testing…');
          try {
            const runtime = PiAgentServices.createChatRuntime({ plugin: context.plugin });
            if (!runtime.testConnectivity) {
              new Notice('Connectivity test is not available for this agent.');
              return;
            }
            const result = await runtime.testConnectivity();
            new Notice(
              result.ok ? `Connection OK: ${result.detail}` : `Connection failed: ${result.detail}`,
              result.ok ? 8000 : 0,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Connection test error: ${message}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText(previousLabel);
          }
        });
      });

    new Setting(container)
      .setName('Global environment variables')
      .setDesc('Extra global environment variables passed to the in-process Pi agent.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter environment variables (e.g. Key=value)...')
          .setValue(piSettings.environmentVariables)
          .onChange(async (value) => {
            updatePiAgentSettings(settingsBag, { environmentVariables: value });
            await context.plugin.saveSettings();
          })
      );

    // AI Providers and Credentials
    new Setting(container).setName('AI model providers').setHeading();
    const providersDesc = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
    providersDesc.createEl('p', {
      text: 'API keys and OAUTH tokens are stored in Obsidian keychain after you enter them once. Providers with keychain secrets show as Configured. Disabled providers stay in settings but are hidden from the model picker.',
    });

    // Populate all available providers from models cache + standard list
    const allProvidersSet = new Set<string>();
    for (const model of PI_AI_MODELS_CACHE.values()) {
      if (model.provider) {
        allProvidersSet.add(model.provider);
      }
    }
    // Fallback when cache hasn't loaded (shouldn't happen since warm is awaited)
    if (allProvidersSet.size === 0) {
      const knownProviders = [
        'amazon-bedrock','anthropic','azure-openai-responses','cerebras',
        'cloudflare-ai-gateway','cloudflare-workers-ai','deepseek',
        'fireworks','github-copilot','google','google-vertex','groq',
        'huggingface','kimi-coding','minimax','minimax-cn','mistral',
        'moonshotai','moonshotai-cn','openai','openai-codex',
        'opencode','opencode-go','openrouter','together',
        'vercel-ai-gateway','xai','xiaomi','xiaomi-token-plan-ams',
        'xiaomi-token-plan-cn','xiaomi-token-plan-sgp','zai',
      ];
      for (const p of knownProviders) {
        allProvidersSet.add(p);
      }
    }
    const allAvailableProviders = Array.from(allProvidersSet).sort();
    const providersNotAdded = allAvailableProviders.filter(p => !piSettings.addedProviders.includes(p));

    preloadProviderLogos(
      [...providersNotAdded, ...listProviderIdsWithKeychainSecrets(secretStorage)]
        .map((id) => getProviderLogoSlug(id))
        .filter((slug): slug is string => !!slug),
    );

    let selectedProviderToAdd = '';

    // Add Provider Control Row (custom picker — Obsidian dropdown has no per-option icons)
    const addProviderSetting = new Setting(container)
      .setName('Add AI provider')
      .setDesc('Select an LLM provider supported by Pi to configure and add its models.');

    const addControls = addProviderSetting.controlEl.createDiv({ cls: 'obsius2-provider-add-controls' });
    const pickerContainer = addControls.createDiv({ cls: 'obsius2-provider-add-container' });

    const pickerTrigger = pickerContainer.createEl('button', {
      cls: 'obsius2-provider-add-trigger',
      type: 'button',
    });
    const pickerTriggerLabel = pickerTrigger.createSpan({ cls: 'obsius2-provider-add-trigger-label' });
    pickerTriggerLabel.setText('Select provider...');

    const pickerDropdown = pickerContainer.createDiv({ cls: 'obsius2-provider-add-dropdown' });

    const renderPickerLabel = (providerId: string) => {
      pickerTrigger.empty();
      if (!providerId) {
        pickerTrigger.createSpan({ cls: 'obsius2-provider-add-trigger-label', text: 'Select provider...' });
        return;
      }
      const slug = getProviderLogoSlug(providerId);
      if (slug) {
        appendProviderLogo(pickerTrigger, slug, { size: 16, className: 'obsius2-provider-add-option-logo' });
      }
      pickerTrigger.createSpan({
        cls: 'obsius2-provider-add-trigger-label',
        text: getDisplayName(providerId),
      });
    };

    for (const prov of providersNotAdded) {
      const option = pickerDropdown.createDiv({ cls: 'obsius2-provider-add-option' });
      const slug = getProviderLogoSlug(prov);
      if (slug) {
        appendProviderLogo(option, slug, { size: 16, className: 'obsius2-provider-add-option-logo' });
      }
      option.createSpan({ text: getDisplayName(prov) });
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedProviderToAdd = prov;
        renderPickerLabel(prov);
        pickerDropdown.removeClass('is-visible');
      });
    }

    if (providersNotAdded.length === 0) {
      pickerTrigger.disabled = true;
      pickerTriggerLabel.setText('All providers added');
    }

    pickerTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (providersNotAdded.length === 0) {
        return;
      }
      pickerDropdown.toggleClass('is-visible', !pickerDropdown.hasClass('is-visible'));
    });

    (container.ownerDocument ?? window.document).addEventListener('click', () => {
      pickerDropdown.removeClass('is-visible');
    });

    addControls.createEl('button', { cls: 'mod-cta', text: '+ add', type: 'button' })
      .addEventListener('click', async () => {
        if (!selectedProviderToAdd) {
          new Notice('Please select a provider to add.');
          return;
        }
        const added = [...piSettings.addedProviders, selectedProviderToAdd];
        updatePiAgentSettings(settingsBag, { addedProviders: added });
        await context.plugin.saveSettings();
        context.redisplay();
        new Notice(`Added ${getDisplayName(selectedProviderToAdd)} provider.`);
      });

    const providersContainer = container.createDiv({ cls: 'obsius2-providers-list' });

    for (const providerId of piSettings.addedProviders) {
      const info = getProviderEnvVarNames(providerId);
      const displayName = getDisplayName(providerId);
      const providerDisabled = isProviderDisabled(piSettings.disabledProviders, providerId);

      const card = providersContainer.createEl('details', { cls: 'obsius2-provider-card' });
      if (providerDisabled) {
        card.addClass('obsius2-provider-card-disabled');
      }
      const summary = card.createEl('summary', { cls: 'obsius2-provider-header' });

      const titleRow = summary.createDiv({ cls: 'obsius2-provider-title-row' });
      const logoSlug = getProviderLogoSlug(providerId);
      if (logoSlug) {
        appendProviderLogo(titleRow, logoSlug, { size: 18, className: 'obsius2-provider-card-logo' });
      }
      titleRow.createSpan({ cls: 'obsius2-provider-title', text: displayName });
      
      const codexConnected = providerId === CODEX_OAUTH_PROVIDER_ID
        ? maybeGetPiWorkspaceServices()?.providerOAuth?.hasCodexAuth() ?? false
        : false;

      const updateStatusBadge = () => {
        const configured = isProviderConfigured(
          secretStorage,
          providerId,
          piSettings.environmentVariables,
          {
            codexConnected,
            disabledProviders: piSettings.disabledProviders,
          },
        );
        if (providerDisabled) {
          statusBadge.setText('Disabled');
          statusBadge.className = 'obsius2-provider-status disabled';
          return;
        }
        statusBadge.setText(configured ? 'Configured' : 'Not configured');
        statusBadge.className = `obsius2-provider-status ${configured ? 'configured' : 'not-configured'}`;
      };

      const statusBadge = summary.createSpan({
        cls: 'obsius2-provider-status not-configured',
        text: providerDisabled ? 'Disabled' : 'Not configured',
      });
      updateStatusBadge();

      const disableBtn = summary.createEl('button', {
        cls: 'obsius2-provider-disable-btn',
        text: providerDisabled ? 'Enable' : 'Disable',
      });
      disableBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const disabled = new Set(piSettings.disabledProviders);
        if (disabled.has(providerId)) {
          disabled.delete(providerId);
        } else {
          disabled.add(providerId);
        }
        updatePiAgentSettings(settingsBag, { disabledProviders: [...disabled] });
        await context.plugin.saveSettings();
        context.redisplay();
        for (const view of context.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      });

      const removeBtn = summary.createEl('button', {
        cls: 'obsius2-provider-remove-btn',
        text: 'Remove'
      });
      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const added = piSettings.addedProviders.filter(p => p !== providerId);
        const visible = piSettings.visibleModels.filter(m => !m.startsWith(`${providerId}/`));
        
        updatePiAgentSettings(settingsBag, { addedProviders: added, visibleModels: visible });
        await context.plugin.saveSettings();
        context.redisplay();
        new Notice(`Removed ${displayName} provider.`);
      });

      const body = card.createDiv({ cls: 'obsius2-provider-body' });

      if (providerId === CODEX_OAUTH_PROVIDER_ID) {
        const providerOAuth = maybeGetPiWorkspaceServices()?.providerOAuth;

        new Setting(body)
          .setName('OpenAI Codex subscription')
          .setDesc(
            'Sign in with your ChatGPT/Codex subscription. Credentials are stored in .obsius/auth.json (vault-local).',
          )
          .addButton((btn) => {
            btn.setButtonText(codexConnected ? 'Reconnect' : 'Connect');
            btn.onClick(async () => {
              if (!providerOAuth) {
                new Notice('Provider OAuth is not initialized. Reload the plugin.');
                return;
              }
              btn.setDisabled(true);
              try {
                await providerOAuth.loginCodex((msg) => {
                  new Notice(msg, 5000);
                });
                new Notice('OpenAI Codex connected.');
                context.redisplay();
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(`Codex login failed: ${message}`);
              } finally {
                btn.setDisabled(false);
              }
            });
          })
          .addButton((btn) => {
            btn.setButtonText('Disconnect');
            btn.setDisabled(!codexConnected);
            btn.onClick(async () => {
              providerOAuth?.logoutCodex();
              new Notice('OpenAI Codex disconnected.');
              context.redisplay();
            });
          });
        continue;
      }

      // Credentials Input section
      new Setting(body).setName("Authentication & credentials").setHeading();
      
      const apiKeyInKeychain = !!getProviderCredentialSecret(secretStorage, providerId, 'api-key');
      const oauthInKeychain = info.oauthVar
        ? !!getProviderCredentialSecret(secretStorage, providerId, 'oauth-token')
        : false;

      let activeAuthType: 'api' | 'oauth' = oauthInKeychain ? 'oauth' : 'api';

      const authToggleWrapper = body.createDiv({ cls: 'obsius2-auth-toggle-wrapper obsius2-hidden' });
      if (info.oauthVar) {
        authToggleWrapper.removeClass('obsius2-hidden');
        const apiBtn = authToggleWrapper.createEl('button', {
          cls: `obsius2-auth-toggle-btn ${activeAuthType === 'api' ? 'active' : ''}`,
          text: 'API key'
        });
        const oauthBtn = authToggleWrapper.createEl('button', {
          cls: `obsius2-auth-toggle-btn ${activeAuthType === 'oauth' ? 'active' : ''}`,
          text: 'OAUTH token'
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

      // API Key input row
      const apiInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'oauth' ? 'obsius2-hidden' : ''}` });
      new Setting(apiInputRow)
        .setName('API key')
        .setDesc(`Saved in Obsidian keychain as ${getProviderCredentialSecretId(providerId, 'api-key')}.`)
        .addText((text) => {
          text
            .setPlaceholder(
              apiKeyInKeychain
                ? 'Saved in keychain (enter to replace)'
                : 'Enter API key...',
            )
            .setValue('')
            .onChange(async (val) => {
              if (!val.trim()) {
                return;
              }
              setProviderCredentialSecret(secretStorage, providerId, 'api-key', val);
              const updatedEnv = setEnvVarValue(piSettings.environmentVariables, info.apiKeyVar, '');
              piSettings = updatePiAgentSettings(settingsBag, { environmentVariables: updatedEnv });
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
              setProviderCredentialSecret(secretStorage, providerId, 'api-key', '');
              updateStatusBadge();
            });
        });

      // OAuth input row
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
                oauthInKeychain
                  ? 'Saved in keychain (enter to replace)'
                  : 'Enter OAUTH token...',
              )
              .setValue('')
              .onChange(async (val) => {
                if (!val.trim()) {
                  return;
                }
                setProviderCredentialSecret(secretStorage, providerId, 'oauth-token', val);
                const updatedEnv = setEnvVarValue(
                  piSettings.environmentVariables,
                  info.oauthVar!,
                  '',
                );
                piSettings = updatePiAgentSettings(settingsBag, { environmentVariables: updatedEnv });
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
                setProviderCredentialSecret(secretStorage, providerId, 'oauth-token', '');
                updateStatusBadge();
              });
          });
      }

      // Models checklists section
      new Setting(body).setName("Candidate models pool").setHeading();
      const modelsGrid = body.createDiv({ cls: 'obsius2-models-checklist-grid' });

      const providerModels = getPiAiModelsForProvider(providerId);
      for (const model of providerModels) {
        const isChecked = piSettings.visibleModels.includes(model.value);

        const checkboxWrapper = modelsGrid.createDiv({ cls: 'obsius2-model-checkbox-wrapper' });
        const checkbox = checkboxWrapper.createEl('input', {
          type: 'checkbox',
          cls: 'obsius2-model-checkbox',
          attr: { id: `checkbox-${model.value.replace(/\//g, '-')}` }
        });
        checkbox.checked = isChecked;

        const label = checkboxWrapper.createEl('label', {
          cls: 'obsius2-model-checkbox-label',
          attr: { for: `checkbox-${model.value.replace(/\//g, '-')}` }
        });
        label.createSpan({ cls: 'obsius2-model-checkbox-title', text: model.label });
        label.createSpan({ cls: 'obsius2-model-checkbox-desc', text: model.description });

        checkbox.addEventListener('change', async () => {
          let visible = [...piSettings.visibleModels];
          if (checkbox.checked) {
            if (!visible.includes(model.value)) {
              visible.push(model.value);
            }
          } else {
            visible = visible.filter(v => v !== model.value);
          }

          updatePiAgentSettings(settingsBag, { visibleModels: visible });
          await context.plugin.saveSettings();
          
          for (const view of context.plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        });
      }

      if (providerModels.length === 0) {
        modelsGrid.createDiv({ cls: 'obsius2-no-models-message', text: 'No predefined models loaded for this provider yet.' });
      }
    }
  }
