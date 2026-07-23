import { getActivePiviNetworkClients } from "@pivi/obsidian-host/createPiviNetworkClients";
import { mergeCustomProviderHeaderSecrets } from "@pivi/pivi-agent-core/auth/customProviderHeaderSecrets";
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import { fetchCustomProviderModels } from "@pivi/pivi-agent-core/engine/pi/installPiCustomProviders";
import { syncCustomPiProviders } from "@pivi/pivi-agent-core/engine/pi/piAiModels";
import { piChatUIConfig } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import { getPiAiModelsForProvider } from "@pivi/pivi-agent-core/engine/pi/piModelRegistry";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import { updatePiAgentSettings } from "@pivi/pivi-agent-core/foundation/agentSettings";
import {
  getCustomProviderById,
  getCustomProvidersFromBag,
} from "@pivi/pivi-agent-core/foundation/customProviders";
import { grantPrivateOrigins } from "@pivi/pivi-agent-core/network";
import type { SyncSecretStore } from "@pivi/pivi-agent-core/ports";

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

/**
 * App-owned facades that hide Pi engine details from product UI.
 * Constructed once at composition; UI must call these instead of engine/pi imports.
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
          ? { ...provider, models: result.models }
          : provider,
      );
      updatePiAgentSettings(settings, { customProviders });
      syncCustomPiProviders(customProviders);
      return { count: result.models.length };
    },
  };
}
