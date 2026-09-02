import { deleteCustomProviderHeaders } from '@pivi/agent/auth/customProviderHeaderSecrets';
import {
  CODEX_OAUTH_PROVIDER_ID,
  getPiAiCredentialSecretId,
  INTERACTIVE_OAUTH_PROVIDER_IDS,
  isDualAuthOAuthProviderId,
  SUBSCRIPTION_OAUTH_PROVIDER_IDS,
} from '@pivi/agent/auth/piProviderCredentials';
import { SUPPORTED_PI_PROVIDER_IDS } from '@pivi/agent/auth/piProviderValidation';
import { getProviderEnvVarNames } from '@pivi/agent/auth/providerEnvVars';
import { deriveProviderReadinessStatus } from '@pivi/agent/auth/providerReadiness';
import { isSecretStorageAvailable, MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN } from '@pivi/agent/auth/providerSecretStorage';
import { getPiAgentSettings, updatePiAgentSettings } from '@pivi/agent/settings/agentSettings';
import {
  ALL_CUSTOM_PROVIDER_KINDS,
  applyCustomProviderModelIds,
  createDefaultCustomProviderConfig,
  type CustomProviderKind,
  FIXED_LOCAL_PROVIDER_IDS,
  getCustomProviderKindDisplayName,
  getCustomProvidersFromBag,
  isLocalCustomProviderKind,
  reconcileVisibleModelsForCustomProviders,
  splitCustomProviderModelIdInputs,
} from '@pivi/agent/settings/customProviders';
import {
  getLogoSlugForCustomProviderKind,
  getProviderDisplayName,
  getProviderLogoSlug,
} from '@pivi/agent/settings/modelDisplay';
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
  const getProviderReadiness = (providerId: string) => {
    const piSettings = getPiAgentSettings(host.settings);
    const custom = piSettings.customProviders.find(provider => provider.id === providerId);
    const allowKeyless = !!custom && custom.apiKeyRequired === false;
    const interactiveOAuthConnected = (INTERACTIVE_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId)
      ? (workspace.providerOAuth?.hasProviderOAuth(providerId) ?? false)
      : false;
    return deriveProviderReadinessStatus({
      providerId,
      piSettings: {
        ...piSettings,
        // Settings presents enablement separately. Readiness answers whether a
        // disabled provider has enough configuration to be enabled.
        disabledProviders: piSettings.disabledProviders.filter(id => id !== providerId),
      },
      credential: workspace.credentialStore?.readSync(providerId),
      interactiveOAuthConnected,
      modelCount: uiFacades.listModelsForProvider(providerId).length,
      allowKeyless,
    }).kind;
  };

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
    getContextWindowOverride(modelKey) {
      return host.settings.customContextLimits[modelKey] ?? null;
    },
    async patchContextWindowOverride(modelKey, value) {
      const next = { ...host.settings.customContextLimits };
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        next[modelKey] = Math.floor(value);
      } else {
        delete next[modelKey];
      }
      host.settings.customContextLimits = next;
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
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
    getReadiness: getProviderReadiness,
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
      if (
        isDualAuthOAuthProviderId(providerId)
        && workspace.credentialStore?.readSync(providerId)?.type !== 'api_key'
      ) {
        throw new Error(appT('settings.modelsTab.dualAuthApiKeyBlocked'));
      }
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
      updatePiAgentSettings(host.settings, {
        addedProviders: [...piSettings.addedProviders, providerId],
        disabledProviders: [...new Set([...piSettings.disabledProviders, providerId])],
      });
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
          disabledProviders: [...new Set([...piSettings.disabledProviders, config.id])],
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
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
    async patchCustomProviderModel(providerId, modelId, patch) {
      const piSettings = getPiAgentSettings(host.settings);
      const customProviders = piSettings.customProviders.map(provider => {
        if (provider.id !== providerId) return provider;
        return {
          ...provider,
          models: provider.models.map(model => {
            if (model.id !== modelId) return model;
            const next = { ...model };
            if (Object.prototype.hasOwnProperty.call(patch, 'catalogModelId')) {
              const catalogModelId = patch.catalogModelId?.trim();
              if (catalogModelId) {
                next.catalogModelId = catalogModelId;
              } else {
                delete next.catalogModelId;
              }
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'maxTokensOverride')) {
              const maxTokensOverride = patch.maxTokensOverride;
              if (typeof maxTokensOverride === 'number' && maxTokensOverride > 0) {
                next.maxTokensOverride = Math.floor(maxTokensOverride);
              } else {
                delete next.maxTokensOverride;
              }
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'reasoningOverride')) {
              if (typeof patch.reasoningOverride === 'boolean') {
                next.reasoningOverride = patch.reasoningOverride;
              } else {
                delete next.reasoningOverride;
              }
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'thinkingFormatOverride')) {
              if (patch.thinkingFormatOverride) {
                next.thinkingFormatOverride = patch.thinkingFormatOverride;
              } else {
                delete next.thinkingFormatOverride;
              }
            }
            return next;
          }),
        };
      });
      updatePiAgentSettings(host.settings, { customProviders });
      uiFacades.syncCustomProviders(host.settings);
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
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
    async setCustomProviderModelIds(providerId, modelIds) {
      const piSettings = getPiAgentSettings(host.settings);
      const provider = piSettings.customProviders.find(entry => entry.id === providerId);
      if (!provider) {
        throw new Error(`Unknown custom provider: ${providerId}`);
      }
      const models = applyCustomProviderModelIds(
        provider.models,
        splitCustomProviderModelIdInputs(modelIds),
      );
      const customProviders = piSettings.customProviders.map(entry =>
        entry.id === providerId ? { ...entry, models } : entry,
      );
      const visibleModels = reconcileVisibleModelsForCustomProviders(
        piSettings.visibleModels,
        customProviders,
      );
      const prefix = `${providerId}/`;
      const allowedKeys = new Set(models.map(model => `${providerId}/${model.id}`));
      const lastModel = host.settings.agentSettings.lastModel;
      const lastModelUpdate = typeof lastModel === 'string'
        && lastModel.startsWith(prefix)
        && !allowedKeys.has(lastModel)
        ? { lastModel: '' }
        : {};
      updatePiAgentSettings(host.settings, {
        customProviders,
        visibleModels,
        ...lastModelUpdate,
      });
      const firstProviderKey = visibleModels.find(key => key.startsWith(prefix));
      if (typeof host.settings.model === 'string' && host.settings.model.startsWith(prefix) && !allowedKeys.has(host.settings.model)) {
        host.settings.model = firstProviderKey ?? '';
      }
      if (
        typeof host.settings.titleGenerationModel === 'string'
        && host.settings.titleGenerationModel.startsWith(prefix)
        && !allowedKeys.has(host.settings.titleGenerationModel)
      ) {
        host.settings.titleGenerationModel = '';
      }
      uiFacades.syncCustomProviders(host.settings);
      await host.saveSettings();
      for (const view of host.getAllViews()) {
        view.getChatHandle()?.maintenance.refreshModelPresentation();
      }
    },
  };
}
