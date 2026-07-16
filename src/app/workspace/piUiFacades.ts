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

import type { PiviUiFacades } from "@/app/hostContracts";

import { obsidianCustomProviderHttpRequest } from "./obsidianHttpRequest";

/**
 * App-owned facades that hide Pi engine details from product UI.
 * Constructed once at composition; UI must call these instead of engine/pi imports.
 */
export function createPiUiFacades(
  getCredentialApiKey?: (providerId: string) => string | undefined,
): PiviUiFacades {
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
      syncCustomPiProviders(getCustomProvidersFromBag(settings));
    },
    async fetchCustomProviderModels(providerId, settings) {
      const config = getCustomProviderById(settings, providerId);
      if (!config) {
        throw new Error(`Unknown custom provider: ${providerId}`);
      }
      const apiKey = getCredentialApiKey?.(providerId);
      const result = await fetchCustomProviderModels(config, obsidianCustomProviderHttpRequest, { apiKey });
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
