import { CODEX_OAUTH_PROVIDER_ID, getPiAiCredentialSecretId } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { isBuiltinPiProviderId, SUPPORTED_PI_PROVIDER_IDS } from '@pivi/pivi-agent-core/auth/piProviderValidation';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { deriveProviderReadinessStatus } from '@pivi/pivi-agent-core/auth/providerReadiness';
import { isSecretStorageAvailable, MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import {
  ALL_CUSTOM_PROVIDER_KINDS,
  createDefaultCustomProviderConfig,
  type CustomProviderKind,
  FIXED_LOCAL_PROVIDER_IDS,
  getCustomProviderKindDisplayName,
  getCustomProvidersFromBag,
  isLocalCustomProviderKind,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import {
  getLogoSlugForCustomProviderKind,
  getProviderDisplayName,
  getProviderLogoSlug,
} from '@pivi/pivi-agent-core/foundation/providerLogos';
import type { SettingsModelsPort } from '@pivi/pivi-react/ports';

import type {
  PiviPluginWorkspace,
  PiviSettingsHost,
  PiviUiFacades,
} from '@/app/hostContracts';
import { t as appT } from '@/app/i18n';

import { removeEnvVar } from './createUiPortHelpers';

export function createSettingsModelsPort(
  host: PiviSettingsHost,
  uiFacades: PiviUiFacades,
  workspace: PiviPluginWorkspace,
): SettingsModelsPort {
  return {
    codexProviderId: CODEX_OAUTH_PROVIDER_ID,
    bootstrap() {
      const secretStorage = host.app.secretStorage;
      const secureStorageAvailable = isSecretStorageAvailable(secretStorage);
      const piSettings = getPiAgentSettings(host.settings);
      if (secureStorageAvailable) {
        const credentialStore = workspace.credentialStore ?? null;
        const customIds = new Set(piSettings.customProviders.map(provider => provider.id));
        const synced = uiFacades.migrateProviderCredentialsToKeychain(
          secretStorage,
          [...new Set([...piSettings.addedProviders, ...(credentialStore?.listProviderIdsSync() ?? [])])],
          piSettings.environmentVariables,
        );
        const supportedAddedProviders = [
          ...new Set([
            ...synced.addedProviders.filter(id => isBuiltinPiProviderId(id) || customIds.has(id)),
            ...piSettings.addedProviders.filter(id => customIds.has(id)),
          ]),
        ];
        const changed = synced.changed
          || supportedAddedProviders.length !== piSettings.addedProviders.length
          || supportedAddedProviders.some((id, index) => id !== piSettings.addedProviders[index])
          || synced.environmentVariables !== piSettings.environmentVariables;
        if (changed) {
          updatePiAgentSettings(host.settings, {
            addedProviders: supportedAddedProviders,
            environmentVariables: synced.environmentVariables,
          });
          void host.saveSettings();
        }
      }
      uiFacades.syncCustomProviders(host.settings);
      return {
        minimumHostVersion: MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN,
        secureStorageAvailable,
      };
    },
    getSettings: () => getPiAgentSettings(host.settings),
    async saveSettings(patch) {
      updatePiAgentSettings(host.settings, patch);
      uiFacades.syncCustomProviders(host.settings);
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
    getProviderDisplayName(providerId) {
      const custom = getCustomProvidersFromBag(host.settings).find(provider => provider.id === providerId);
      return custom?.name ?? getProviderDisplayName(providerId);
    },
    getProviderLogoSlug(providerId) {
      const custom = getCustomProvidersFromBag(host.settings).find(provider => provider.id === providerId);
      if (custom) {
        return getLogoSlugForCustomProviderKind(custom.kind) ?? getProviderLogoSlug(providerId);
      }
      return getProviderLogoSlug(providerId);
    },
    getReadiness(providerId) {
      const piSettings = getPiAgentSettings(host.settings);
      const custom = piSettings.customProviders.find(provider => provider.id === providerId);
      const allowKeyless = !!custom && custom.apiKeyRequired === false;
      const codexConnected = providerId === CODEX_OAUTH_PROVIDER_ID
        ? (workspace.providerOAuth?.hasCodexAuth() ?? false)
        : false;
      return deriveProviderReadinessStatus({
        providerId,
        piSettings,
        credential: workspace.credentialStore?.readSync(providerId),
        codexConnected,
        modelCount: uiFacades.listModelsForProvider(providerId).length,
        allowKeyless,
      }).kind;
    },
    getCredentialKind(providerId) {
      const credential = workspace.credentialStore?.readSync(providerId);
      if (credential?.type === 'api_key') return 'api_key';
      if (credential?.type === 'oauth') return 'oauth';
      return null;
    },
    getProviderEnvInfo(providerId) {
      const info = getProviderEnvVarNames(providerId);
      return info.oauthVar ? { apiKeyVar: info.apiKeyVar, oauthVar: info.oauthVar } : { apiKeyVar: info.apiKeyVar };
    },
    getSecretId: providerId => getPiAiCredentialSecretId(providerId),
    async setApiKey(providerId, key) {
      const store = workspace.credentialStore;
      if (!store) throw new Error('Provider credential storage is unavailable.');
      await store.modify(providerId, () => Promise.resolve({ type: 'api_key', key }));
      const piSettings = getPiAgentSettings(host.settings);
      const environmentVariables = removeEnvVar(piSettings.environmentVariables, getProviderEnvVarNames(providerId).apiKeyVar);
      if (environmentVariables !== piSettings.environmentVariables) {
        updatePiAgentSettings(host.settings, { environmentVariables });
      }
      await host.saveSettings();
    },
    async setOauthToken(providerId, token) {
      const store = workspace.credentialStore;
      if (!store) throw new Error('Provider credential storage is unavailable.');
      await store.modify(providerId, () => Promise.resolve({
        type: 'oauth',
        access: token,
        refresh: '',
        expires: Number.MAX_SAFE_INTEGER,
      }));
      const info = getProviderEnvVarNames(providerId);
      if (info.oauthVar) {
        const piSettings = getPiAgentSettings(host.settings);
        const environmentVariables = removeEnvVar(piSettings.environmentVariables, info.oauthVar);
        if (environmentVariables !== piSettings.environmentVariables) {
          updatePiAgentSettings(host.settings, { environmentVariables });
        }
      }
      await host.saveSettings();
    },
    async clearCredential(providerId) {
      await workspace.credentialStore?.delete(providerId);
    },
    hasCodexAuth: () => workspace.providerOAuth?.hasCodexAuth() ?? false,
    async loginCodex(onProgress) {
      const providerOAuth = workspace.providerOAuth;
      if (!providerOAuth) throw new Error('Provider OAuth is unavailable.');
      await providerOAuth.loginCodex(onProgress);
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
    },
    logoutCodex() {
      workspace.providerOAuth?.logoutCodex();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
    },
    listAddableBuiltinProviders() {
      const added = new Set(getPiAgentSettings(host.settings).addedProviders);
      return [...SUPPORTED_PI_PROVIDER_IDS]
        .sort()
        .filter(id => !added.has(id))
        .map(id => ({ id, name: getProviderDisplayName(id), logoSlug: getProviderLogoSlug(id) }));
    },
    listAddableLocalKinds() {
      const added = new Set(getPiAgentSettings(host.settings).addedProviders);
      return ALL_CUSTOM_PROVIDER_KINDS
        .filter(kind => isLocalCustomProviderKind(kind))
        .filter(kind => !added.has(FIXED_LOCAL_PROVIDER_IDS[kind as keyof typeof FIXED_LOCAL_PROVIDER_IDS]))
        .map(kind => ({ kind, name: getCustomProviderKindDisplayName(kind), logoSlug: getLogoSlugForCustomProviderKind(kind) }));
    },
    listCustomKinds() {
      return ALL_CUSTOM_PROVIDER_KINDS
        .filter(kind => !isLocalCustomProviderKind(kind))
        .map(kind => ({ kind, name: getCustomProviderKindDisplayName(kind), logoSlug: getLogoSlugForCustomProviderKind(kind) }));
    },
    async addBuiltinProvider(providerId) {
      const piSettings = getPiAgentSettings(host.settings);
      if (!providerId || piSettings.addedProviders.includes(providerId)) return;
      updatePiAgentSettings(host.settings, { addedProviders: [...piSettings.addedProviders, providerId] });
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
    async addCustomKind(kind) {
      const piSettings = getPiAgentSettings(host.settings);
      const existingIds = [...piSettings.addedProviders, ...piSettings.customProviders.map(provider => provider.id)];
      const config = createDefaultCustomProviderConfig(kind as CustomProviderKind, existingIds);
      if (!piSettings.addedProviders.includes(config.id)) {
        updatePiAgentSettings(host.settings, {
          customProviders: [...piSettings.customProviders, config],
          addedProviders: [...piSettings.addedProviders, config.id],
        });
        uiFacades.syncCustomProviders(host.settings);
        await host.saveSettings();
        for (const view of host.getAllViews()) {
          view.getChatHandle()?.maintenance.refreshModelPresentation();
        }
      }
      return config.id;
    },
    async removeProvider(providerId) {
      const piSettings = getPiAgentSettings(host.settings);
      updatePiAgentSettings(host.settings, {
        addedProviders: piSettings.addedProviders.filter(id => id !== providerId),
        visibleModels: piSettings.visibleModels.filter(model => !model.startsWith(`${providerId}/`)),
        customProviders: piSettings.customProviders.filter(provider => provider.id !== providerId),
      });
      uiFacades.syncCustomProviders(host.settings);
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
    async testProvider(providerId) {
      const readiness = workspace.modelReadinessProvider;
      if (!readiness.testProvider) {
        return { ok: false, detail: appT('settings.modelsTab.readinessProviderUnavailable') };
      }
      return readiness.testProvider(providerId, host.settings);
    },
    async patchCustomProvider(providerId, patch) {
      const piSettings = getPiAgentSettings(host.settings);
      const customProviders = piSettings.customProviders.map(provider =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      );
      updatePiAgentSettings(host.settings, { customProviders });
      uiFacades.syncCustomProviders(host.settings);
      await host.saveSettings();
    },
    async fetchCustomProviderModels(providerId) {
      uiFacades.syncCustomProviders(host.settings);
      const result = await uiFacades.fetchCustomProviderModels(providerId, host.settings);
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
      return result;
    },
    notify: message => host.notify?.(message),
  };
}
