import { maybeGetPiWorkspaceServices } from '../../app/PiWorkspaceServices';
import { migratePiProviderCredentialsToKeychain } from '../../auth/ObsidianCredentialStore';
import {
  isSecretStorageAvailable,
  MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
} from '../../auth/ProviderSecretStorage';
import { isSupportedPiProviderId, SUPPORTED_PI_PROVIDER_IDS } from '../../piAiModels';
import { getPiAgentSettings, updatePiAgentSettings } from '../../settings';
import { PI_AI_MODELS_CACHE } from '../PiChatUIConfig';
import { getProviderDisplayName } from '../providerLogos';
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
    const warn = container.createDiv({ cls: 'pivi-sp-settings-desc' });
    warn.createEl('p', {
      text: `Provider API keys require Obsidian ${MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN} or newer (Obsidian keychain / SecretStorage). Upgrade Obsidian to use keychain-backed credentials.`,
    });
  }

  let piSettings = getPiAgentSettings(settingsBag);
  const credentialStore = maybeGetPiWorkspaceServices()?.credentialStore ?? null;

  const synced = isSecretStorageAvailable(secretStorage)
    ? migratePiProviderCredentialsToKeychain(
        secretStorage,
        [...new Set([...piSettings.addedProviders, ...(credentialStore?.listProviderIdsSync() ?? [])])],
        piSettings.environmentVariables,
      )
    : {
        addedProviders: piSettings.addedProviders,
        environmentVariables: piSettings.environmentVariables,
        changed: false,
      };
  const supportedAddedProviders = synced.addedProviders.filter(isSupportedPiProviderId);
  const supportedProvidersChanged = supportedAddedProviders.length !== synced.addedProviders.length;
  if (synced.changed || supportedProvidersChanged) {
    piSettings = updatePiAgentSettings(settingsBag, {
      addedProviders: supportedAddedProviders,
      environmentVariables: synced.environmentVariables,
    });
    void context.plugin.saveSettings();
  }

  const state = createPiModelsSettingsState(settingsBag, piSettings);
  const getDisplayName = (id: string): string => getProviderDisplayName(id);

  const providersDesc = container.createDiv({ cls: 'pivi-sp-settings-desc' });
  providersDesc.createEl('p', {
    text: 'API keys and OAUTH tokens are stored in Obsidian keychain. Disabled providers stay saved but are hidden from the model picker.',
  });

  const allProvidersSet = new Set<string>();
  for (const model of PI_AI_MODELS_CACHE.values()) {
    if (model.provider && isSupportedPiProviderId(model.provider)) {
      allProvidersSet.add(model.provider);
    }
  }
  if (allProvidersSet.size === 0) {
    for (const p of SUPPORTED_PI_PROVIDER_IDS) {
      allProvidersSet.add(p);
    }
  }
  const allAvailableProviders = Array.from(allProvidersSet).sort();
  const providersNotAdded = allAvailableProviders.filter(
    (p) => !state.piSettings.addedProviders.includes(p),
  );

  const providersContainer = container.createDiv({ cls: 'pivi-providers-list' });

  for (const providerId of state.piSettings.addedProviders) {
    renderProviderRow(providersContainer, context, state, providerId, getDisplayName);
  }

  renderAddProviderPicker(container, context, state, providersNotAdded, getDisplayName);
}
