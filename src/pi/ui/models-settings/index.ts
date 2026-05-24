import { Setting } from 'obsidian';

import { preloadProviderLogos } from '../../../shared/providerLogo';
import {
  isSecretStorageAvailable,
  listProviderIdsWithKeychainSecrets,
  MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
  syncPiProvidersFromKeychain,
} from '../../auth/ProviderSecretStorage';
import { getPiAgentSettings, updatePiAgentSettings } from '../../settings';
import { PI_AI_MODELS_CACHE } from '../PiChatUIConfig';
import { getProviderDisplayName, getProviderLogoSlug } from '../providerLogos';
import { renderPiAgentSetupSection } from './envVarsSection';
import { renderAddProviderPicker } from './modelPicker';
import { renderProviderRow } from './renderProviderRow';
import { createPiModelsSettingsState, type PiModelsSettingsContext } from './types';

export type { PiModelsSettingsContext } from './types';

export function renderPiModelsSettingsSection(
  container: HTMLElement,
  context: PiModelsSettingsContext,
): void {
  const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
  const secretStorage = context.plugin.app.secretStorage;

  if (!isSecretStorageAvailable(secretStorage)) {
    const warn = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
    warn.createEl('p', {
      text: `Provider API keys require Obsidian ${MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN} or newer (Obsidian keychain / SecretStorage). Upgrade Obsidian to use keychain-backed credentials.`,
    });
  }

  let piSettings = getPiAgentSettings(settingsBag);

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

  const state = createPiModelsSettingsState(settingsBag, secretStorage, piSettings);
  const getDisplayName = (id: string): string => getProviderDisplayName(id);

  renderPiAgentSetupSection(container, context, state);

  new Setting(container).setName('AI model providers').setHeading();
  const providersDesc = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
  providersDesc.createEl('p', {
    text: 'API keys and OAUTH tokens are stored in Obsidian keychain after you enter them once. Providers with keychain secrets show as Configured. Disabled providers stay in settings but are hidden from the model picker.',
  });

  const allProvidersSet = new Set<string>();
  for (const model of PI_AI_MODELS_CACHE.values()) {
    if (model.provider) {
      allProvidersSet.add(model.provider);
    }
  }
  if (allProvidersSet.size === 0) {
    const knownProviders = [
      'amazon-bedrock',
      'anthropic',
      'azure-openai-responses',
      'cerebras',
      'cloudflare-ai-gateway',
      'cloudflare-workers-ai',
      'deepseek',
      'fireworks',
      'github-copilot',
      'google',
      'google-vertex',
      'groq',
      'huggingface',
      'kimi-coding',
      'minimax',
      'minimax-cn',
      'mistral',
      'moonshotai',
      'moonshotai-cn',
      'openai',
      'openai-codex',
      'opencode',
      'opencode-go',
      'openrouter',
      'together',
      'vercel-ai-gateway',
      'xai',
      'xiaomi',
      'xiaomi-token-plan-ams',
      'xiaomi-token-plan-cn',
      'xiaomi-token-plan-sgp',
      'zai',
    ];
    for (const p of knownProviders) {
      allProvidersSet.add(p);
    }
  }
  const allAvailableProviders = Array.from(allProvidersSet).sort();
  const providersNotAdded = allAvailableProviders.filter(
    (p) => !state.piSettings.addedProviders.includes(p),
  );

  preloadProviderLogos(
    [...providersNotAdded, ...listProviderIdsWithKeychainSecrets(secretStorage)]
      .map((id) => getProviderLogoSlug(id))
      .filter((slug): slug is string => !!slug),
  );

  renderAddProviderPicker(container, context, state, providersNotAdded, getDisplayName);

  const providersContainer = container.createDiv({ cls: 'obsius2-providers-list' });

  for (const providerId of state.piSettings.addedProviders) {
    renderProviderRow(providersContainer, context, state, providerId, getDisplayName);
  }
}
