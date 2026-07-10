import { isBuiltinPiProviderId, SUPPORTED_PI_PROVIDER_IDS } from '@pivi/pivi-agent-core/auth/piProviderValidation';
import {
  isSecretStorageAvailable,
  MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
} from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { getProviderDisplayName } from '@pivi/pivi-agent-core/foundation/providerLogos';

import { t } from '@/i18n';

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
      text: t('settings.modelsTab.keychainRequired', {
        version: MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
      }),
    });
  }

  let piSettings = getPiAgentSettings(settingsBag);
  const credentialStore = context.plugin.getPiWorkspace()?.credentialStore ?? null;
  const customIds = new Set(piSettings.customProviders.map((provider) => provider.id));

  const synced = isSecretStorageAvailable(secretStorage)
    ? context.plugin.getUiFacades().migrateProviderCredentialsToKeychain(
        secretStorage,
        [...new Set([...piSettings.addedProviders, ...(credentialStore?.listProviderIdsSync() ?? [])])],
        piSettings.environmentVariables,
      )
    : {
        addedProviders: piSettings.addedProviders,
        environmentVariables: piSettings.environmentVariables,
        changed: false,
      };
  // Keep custom/local providers even if credential migration only returns builtins.
  const supportedAddedProviders = [
    ...new Set([
      ...synced.addedProviders.filter(
        (id) => isBuiltinPiProviderId(id) || customIds.has(id),
      ),
      ...piSettings.addedProviders.filter((id) => customIds.has(id)),
    ]),
  ];
  const supportedProvidersChanged =
    supportedAddedProviders.length !== piSettings.addedProviders.length
    || supportedAddedProviders.some((id, index) => id !== piSettings.addedProviders[index])
    || synced.environmentVariables !== piSettings.environmentVariables;
  if (synced.changed || supportedProvidersChanged) {
    piSettings = updatePiAgentSettings(settingsBag, {
      addedProviders: supportedAddedProviders,
      environmentVariables: synced.environmentVariables,
    });
    void context.plugin.saveSettings();
  }

  context.plugin.getUiFacades().syncCustomProviders(settingsBag);

  const state = createPiModelsSettingsState(settingsBag, piSettings);
  const getDisplayName = (id: string): string => {
    const custom = state.piSettings.customProviders.find((provider) => provider.id === id);
    return custom?.name ?? getProviderDisplayName(id);
  };

  const providersDesc = container.createDiv({ cls: 'pivi-sp-settings-desc' });
  providersDesc.createEl('p', {
    text: t('settings.modelsTab.intro'),
  });

  const allAvailableProviders = [...SUPPORTED_PI_PROVIDER_IDS].sort();
  const providersNotAdded = allAvailableProviders.filter(
    (p) => !state.piSettings.addedProviders.includes(p),
  );

  const providersContainer = container.createDiv({ cls: 'pivi-providers-list' });

  for (const providerId of state.piSettings.addedProviders) {
    renderProviderRow(providersContainer, context, state, providerId, getDisplayName);
  }

  renderAddProviderPicker(container, context, state, providersNotAdded, getDisplayName);
}
