import { mergeCustomProviderHeaderSecrets } from "@pivi/agent/auth/customProviderHeaderSecrets";
import { isSecretStorageAvailable } from "@pivi/agent/auth/providerSecretStorage";
import { grantPrivateOrigins } from "@pivi/agent/network";
import type { SyncSecretStore } from "@pivi/agent/ports";
import { getPiAgentSettings, updatePiAgentSettings } from "@pivi/agent/settings/agentSettings";
import {
  getCustomProviderById,
  getCustomProvidersFromBag,
  mergeFetchedCustomProviderModelUserFields,
  reconcileVisibleModelsForCustomProviders,
} from "@pivi/agent/settings/customProviders";
import {
  fetchCustomProviderModels,
  getPiAiModelsForProvider,
  piChatUIConfig,
  PiSettingsCoordinator,
  syncCustomPiProviders,
} from "@pivi/engine-pi/application/models";
import { getActivePiviNetworkClients } from "@pivi/obsidian-host/createPiviNetworkClients";

import type { PiviUiFacades } from "@/app/hostContracts";

import { createCustomProviderHttpRequest } from "./obsidianHttpRequest";

/** Re-grant provider private origins from the current custom-provider set. */
function regrantProviderPrivateOrigins(
  configs: ReturnType<typeof getCustomProvidersFromBag>,
): void {
  try {
    const grants = getActivePiviNetworkClients().grants;
    grants.revokeByPurpose("provider");
    grantPrivateOrigins(grants, configs.map((provider) => provider.baseUrl), "provider");
  } catch {
    // Network clients may not be installed during early bootstrap; the startup
    // grant pass in createPiWorkspaceServices covers the steady state.
  }
}

function readLastModelFromBag(settings: Record<string, unknown>): string | undefined {
  const agentSettings = settings.agentSettings;
  if (agentSettings && typeof agentSettings === "object" && !Array.isArray(agentSettings)) {
    const lastModel = (agentSettings as Record<string, unknown>).lastModel;
    if (typeof lastModel === "string") {
      return lastModel;
    }
  }
  return undefined;
}

/**
 * App-owned facades that hide Pi engine details from product UI.
 * Constructed once at composition; UI must call these instead of `@pivi/engine-pi` imports.
 */
export function createPiUiFacades(
  getCredentialApiKey?: (providerId: string) => string | undefined,
  secretStorage?: SyncSecretStore,
): PiviUiFacades {
  const withRuntimeHeaders = (settings: Parameters<typeof getCustomProvidersFromBag>[0]) => {
    const configs = getCustomProvidersFromBag(settings);
    if (!secretStorage || !isSecretStorageAvailable(secretStorage)) {
      return configs;
    }
    return mergeCustomProviderHeaderSecrets(secretStorage, configs);
  };

  return {
    chatUIConfig: piChatUIConfig,
    getSettingsSnapshot(settings) {
      return PiSettingsCoordinator.getSettingsSnapshot(settings);
    },
    commitSettingsSnapshot(settings, snapshot) {
      PiSettingsCoordinator.commitSettingsSnapshot(settings, snapshot);
    },
    listModelsForProvider(providerId) {
      return getPiAiModelsForProvider(providerId);
    },
    syncCustomProviders(settings) {
      const configs = withRuntimeHeaders(settings);
      syncCustomPiProviders(configs);
      regrantProviderPrivateOrigins(configs);
    },
    async fetchCustomProviderModels(providerId, settings) {
      const config = getCustomProviderById(settings, providerId);
      if (!config) {
        throw new Error(`Unknown custom provider: ${providerId}`);
      }
      const runtimeConfig = withRuntimeHeaders(settings).find((provider) => provider.id === providerId)
        ?? config;
      const apiKey = getCredentialApiKey?.(providerId);
      const httpGet = createCustomProviderHttpRequest(
        getActivePiviNetworkClients().localProviderHttpClient,
      );
      const result = await fetchCustomProviderModels(runtimeConfig, httpGet, { apiKey });
      const customProviders = getCustomProvidersFromBag(settings).map((provider) =>
        provider.id === providerId
          ? {
            ...provider,
            models: mergeFetchedCustomProviderModelUserFields(result.models, provider.models),
          }
          : provider,
      );
      const current = getPiAgentSettings(settings);
      const visibleModels = reconcileVisibleModelsForCustomProviders(
        current.visibleModels,
        customProviders,
      );
      const prefix = `${providerId}/`;
      const allowedKeys = new Set(result.models.map((model) => `${providerId}/${model.id}`));
      const firstProviderKey = visibleModels.find((key) => key.startsWith(prefix));
      const lastModel = readLastModelFromBag(settings);
      const lastModelUpdate = lastModel && lastModel.startsWith(prefix) && !allowedKeys.has(lastModel)
        ? { lastModel: "" }
        : {};
      updatePiAgentSettings(settings, {
        customProviders,
        visibleModels,
        ...lastModelUpdate,
      });
      if (typeof settings.model === "string" && settings.model.startsWith(prefix) && !allowedKeys.has(settings.model)) {
        settings.model = firstProviderKey ?? "";
      }
      if (
        typeof settings.titleGenerationModel === "string"
        && settings.titleGenerationModel.startsWith(prefix)
        && !allowedKeys.has(settings.titleGenerationModel)
      ) {
        settings.titleGenerationModel = "";
      }
      syncCustomPiProviders(customProviders);
      return { count: result.models.length };
    },
  };
}
