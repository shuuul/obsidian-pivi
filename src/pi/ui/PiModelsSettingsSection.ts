import { Notice, Setting } from 'obsidian';

import { PiAgentServices } from '../../core/agent/PiAgentServices';
import type ObsiusPlugin from '../../main';
import { appendProviderLogo, preloadProviderLogos } from '../../shared/providerLogo';
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
    const piSettings = getPiAgentSettings(settingsBag);

    const getDisplayName = (id: string): string => getProviderDisplayName(id);

    const getProviderEnvVars = (id: string): { apiKeyVar: string; oauthVar?: string } => {
      if (id === 'anthropic') {
        return { apiKeyVar: 'ANTHROPIC_API_KEY', oauthVar: 'ANTHROPIC_OAUTH_TOKEN' };
      }
      if (id === 'google' || id === 'gemini') {
        return { apiKeyVar: 'GEMINI_API_KEY' };
      }
      if (id === 'github-copilot') {
        return { apiKeyVar: 'COPILOT_GITHUB_TOKEN' };
      }
      if (id === 'google-vertex') {
        return { apiKeyVar: 'GOOGLE_CLOUD_API_KEY' };
      }
      if (id === 'huggingface') {
        return { apiKeyVar: 'HF_TOKEN' };
      }
      if (id === 'opencode' || id === 'opencode-go') {
        return { apiKeyVar: 'OPENCODE_API_KEY' };
      }

      const prefix = id.replace(/-/g, '_').toUpperCase();
      return { apiKeyVar: `${prefix}_API_KEY` };
    };

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
      text: 'Configure API keys or OAUTH authentication for the LLM providers supported by the Pi agent, and select candidate models for your selection pool.',
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
      providersNotAdded
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
      const info = getProviderEnvVars(providerId);
      const displayName = getDisplayName(providerId);

      const card = providersContainer.createEl('details', { cls: 'obsius2-provider-card' });
      const summary = card.createEl('summary', { cls: 'obsius2-provider-header' });

      const titleRow = summary.createDiv({ cls: 'obsius2-provider-title-row' });
      const logoSlug = getProviderLogoSlug(providerId);
      if (logoSlug) {
        appendProviderLogo(titleRow, logoSlug, { size: 18, className: 'obsius2-provider-card-logo' });
      }
      titleRow.createSpan({ cls: 'obsius2-provider-title', text: displayName });
      
      const apiKeyVal = getEnvVarValue(piSettings.environmentVariables, info.apiKeyVar);
      const oauthVal = info.oauthVar ? getEnvVarValue(piSettings.environmentVariables, info.oauthVar) : '';
      const isConfigured = !!(apiKeyVal || oauthVal);

      const statusBadge = summary.createSpan({
        cls: `obsius2-provider-status ${isConfigured ? 'configured' : 'not-configured'}`,
        text: isConfigured ? 'Configured' : 'Not Configured'
      });

      // Remove button next to the status badge
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
        const codexConfigured = providerOAuth?.hasCodexAuth() ?? false;
        statusBadge.setText(codexConfigured ? 'Connected' : 'Not connected');
        statusBadge.classList.toggle('configured', codexConfigured);
        statusBadge.classList.toggle('not-configured', !codexConfigured);

        new Setting(body)
          .setName('OpenAI Codex subscription')
          .setDesc(
            'Sign in with your ChatGPT/Codex subscription. Credentials are stored in .obsius/auth.json (vault-local).',
          )
          .addButton((btn) => {
            btn.setButtonText(codexConfigured ? 'Reconnect' : 'Connect');
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
            btn.setDisabled(!codexConfigured);
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
      
      let activeAuthType: 'api' | 'oauth' = oauthVal ? 'oauth' : 'api';

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
        .setDesc(`Enter your ${displayName} API Key.`)
        .addText((text) => {
          text
            .setPlaceholder('Enter API key...')
            .setValue(apiKeyVal)
            .onChange(async (val) => {
              const updatedEnv = setEnvVarValue(piSettings.environmentVariables, info.apiKeyVar, val);
              updatePiAgentSettings(settingsBag, { environmentVariables: updatedEnv });
              await context.plugin.saveSettings();
              
              const freshApiKey = getEnvVarValue(updatedEnv, info.apiKeyVar);
              const freshOauth = info.oauthVar ? getEnvVarValue(updatedEnv, info.oauthVar) : '';
              const freshConfigured = !!(freshApiKey || freshOauth);
              statusBadge.setText(freshConfigured ? 'Configured' : 'Not Configured');
              statusBadge.className = `obsius2-provider-status ${freshConfigured ? 'configured' : 'not-configured'}`;
            });
          text.inputEl.type = 'password';
        });

      // OAuth input row
      const oauthInputRow = body.createDiv({ cls: `obsius2-cred-row ${activeAuthType === 'api' ? 'obsius2-hidden' : ''}` });
      if (info.oauthVar) {
        new Setting(oauthInputRow)
          .setName('OAUTH token')
          .setDesc('Paste your OAUTH token or authorize your account.')
          .addText((text) => {
            text
              .setPlaceholder('Enter OAUTH token...')
              .setValue(oauthVal)
              .onChange(async (val) => {
                const updatedEnv = setEnvVarValue(piSettings.environmentVariables, info.oauthVar!, val);
                updatePiAgentSettings(settingsBag, { environmentVariables: updatedEnv });
                await context.plugin.saveSettings();

                const freshApiKey = getEnvVarValue(updatedEnv, info.apiKeyVar);
                const freshOauth = getEnvVarValue(updatedEnv, info.oauthVar!);
                const freshConfigured = !!(freshApiKey || freshOauth);
                statusBadge.setText(freshConfigured ? 'Configured' : 'Not Configured');
                statusBadge.className = `obsius2-provider-status ${freshConfigured ? 'configured' : 'not-configured'}`;
              });
            text.inputEl.type = 'password';
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
