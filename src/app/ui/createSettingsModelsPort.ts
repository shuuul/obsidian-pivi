import { deleteCustomProviderHeaders } from '@pivi/pivi-agent-core/auth/customProviderHeaderSecrets';
import {
  CODEX_OAUTH_PROVIDER_ID,
  getPiAiCredentialSecretId,
  INTERACTIVE_OAUTH_PROVIDER_IDS,
  SUBSCRIPTION_OAUTH_PROVIDER_IDS,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { SUPPORTED_PI_PROVIDER_IDS } from '@pivi/pivi-agent-core/auth/piProviderValidation';
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
    interactiveOAuthProviderIds: INTERACTIVE_OAUTH_PROVIDER_IDS,
    bootstrap() {
      const secretStorage = host.app.secretStorage;
      const secureStorageAvailable = isSecretStorageAvailable(secretStorage);
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
      // Local provider authority commits inside prepareForSave before the vault
      // write. Do not roll back runtime state if the synced save fails afterward.
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
      const isSubscriptionShell = (SUBSCRIPTION_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
      const interactiveOAuthConnected = isSubscriptionShell || providerId === CODEX_OAUTH_PROVIDER_ID
        ? (workspace.providerOAuth?.hasProviderOAuth(providerId) ?? false)
        : false;
      return deriveProviderReadinessStatus({
        providerId,
        piSettings,
        credential: workspace.credentialStore?.readSync(providerId),
        interactiveOAuthConnected,
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
    hasProviderOAuth: providerId => workspace.providerOAuth?.hasProviderOAuth(providerId) ?? false,
    async loginProviderOAuth(providerId, onProgress) {
      const providerOAuth = workspace.providerOAuth;
      if (!providerOAuth) throw new Error('Provider OAuth is unavailable.');
      await providerOAuth.loginProviderOAuth(providerId, onProgress);
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
    },
    cancelProviderOAuthLogin(providerId) {
      workspace.providerOAuth?.cancelProviderOAuthLogin(providerId);
    },
    async logoutProviderOAuth(providerId) {
      await workspace.providerOAuth?.logoutProviderOAuth(providerId);
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.invalidateSlashCatalog();
      }
    },
    listAddableBuiltinProviders() {
      const added = new Set(getPiAgentSettings(host.settings).addedProviders);
      const builtins = [...SUPPORTED_PI_PROVIDER_IDS]
        .sort()
        .filter(id => !added.has(id))
        .map(id => ({ id, name: getProviderDisplayName(id), logoSlug: getProviderLogoSlug(id) }));
      const subscriptions = [...SUBSCRIPTION_OAUTH_PROVIDER_IDS]
        .filter(id => !added.has(id))
        .map(id => ({ id, name: getProviderDisplayName(id), logoSlug: getProviderLogoSlug(id) }));
      return [...builtins, ...subscriptions];
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
    async removeProvider(providerId, deleteCredential) {
      const credentialStore = workspace.credentialStore;
      if (deleteCredential && !credentialStore) {
        throw new Error('Provider credential storage is unavailable.');
      }
      const piSettings = getPiAgentSettings(host.settings);
      const remainingProviders = piSettings.addedProviders.filter(id => id !== providerId);
      const remainingDisabledProviders = piSettings.disabledProviders.filter(id => id !== providerId);
      const enabledProviders = remainingProviders.filter(id => !remainingDisabledProviders.includes(id));
      const remainingCustomProviders = piSettings.customProviders.filter(provider => provider.id !== providerId);
      let remainingVisibleModels = piSettings.visibleModels.filter(model => !model.startsWith(`${providerId}/`));
      updatePiAgentSettings(host.settings, {
        addedProviders: remainingProviders,
        disabledProviders: remainingDisabledProviders,
        visibleModels: remainingVisibleModels,
        customProviders: remainingCustomProviders,
      });
      uiFacades.syncCustomProviders(host.settings);

      const enabledVisibleModels = remainingVisibleModels.filter(model =>
        enabledProviders.some(id => model.startsWith(`${id}/`)),
      );
      if (enabledVisibleModels.length === 0) {
        const fallbackModel = enabledProviders
          .flatMap(id => uiFacades.listModelsForProvider(id))
          .at(0)?.value;
        if (fallbackModel) {
          remainingVisibleModels = [fallbackModel, ...remainingVisibleModels];
          updatePiAgentSettings(host.settings, { visibleModels: remainingVisibleModels });
        }
      }

      if (typeof host.settings.model === 'string' && host.settings.model.startsWith(`${providerId}/`)) {
        host.settings.model = enabledVisibleModels[0]
          ?? remainingVisibleModels.find(model => enabledProviders.some(id => model.startsWith(`${id}/`)))
          ?? '';
      }
      if (
        typeof host.settings.titleGenerationModel === 'string'
        && host.settings.titleGenerationModel.startsWith(`${providerId}/`)
      ) {
        host.settings.titleGenerationModel = '';
      }

      if (enabledProviders.length > 0) {
        uiFacades.commitSettingsSnapshot(
          host.settings,
          uiFacades.getSettingsSnapshot(host.settings),
        );
      }
      await host.saveSettings();
      if (deleteCredential) {
        await credentialStore?.delete(providerId);
        if (isSecretStorageAvailable(host.app.secretStorage)) {
          deleteCustomProviderHeaders(host.app.secretStorage, providerId);
        }
      }
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
    async ensureProviderCredentials() {
      const readiness = workspace.modelReadinessProvider;
      if (!readiness.ensureProviderCredentials) {
        return;
      }
      await readiness.ensureProviderCredentials(host.settings);
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
  };
}
