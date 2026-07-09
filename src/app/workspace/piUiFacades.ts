import { piChatUIConfig } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import { getPiAiModelsForProvider } from "@pivi/pivi-agent-core/engine/pi/piModelRegistry";
import { migratePiProviderCredentialsToKeychain } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";

import type { PiviUiFacades } from "@/app/hostContracts";

/**
 * App-owned facades that hide Pi engine details from product UI.
 * Constructed once at composition; UI must call these instead of engine/pi imports.
 */
export function createPiUiFacades(): PiviUiFacades {
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
    migrateProviderCredentialsToKeychain(
      secretStorage,
      addedProviders,
      environmentVariables,
    ) {
      return migratePiProviderCredentialsToKeychain(
        secretStorage,
        addedProviders,
        environmentVariables,
      );
    },
  };
}
