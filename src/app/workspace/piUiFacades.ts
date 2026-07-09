import { piChatUIConfig } from "@pivi/pivi-agent-core/engine/pi/piChatUiConfig";
import {
  getPiAiModelsForProvider,
  type PiModelOption,
} from "@pivi/pivi-agent-core/engine/pi/piModelRegistry";
import { migratePiProviderCredentialsToKeychain } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import { PiSettingsCoordinator } from "@pivi/pivi-agent-core/engine/pi/piSettingsCoordinator";
import type { ChatUIConfig } from "@pivi/pivi-agent-core/foundation/chatUi";
import type { SyncSecretStore } from "@pivi/pivi-agent-core/ports";

/**
 * App-owned facades that hide Pi engine details from product UI.
 * Constructed once at composition; UI must call these instead of engine/pi imports.
 */
export interface PiUiFacades {
  /** Chat toolbar/settings model-selector configuration. */
  readonly chatUIConfig: ChatUIConfig;

  /** Project active model/reasoning fields onto a settings snapshot. */
  getSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T;

  /** Write a settings snapshot back into durable settings. */
  commitSettingsSnapshot(
    settings: Record<string, unknown>,
    snapshot: Record<string, unknown>,
  ): void;

  /** List catalog models for one provider (settings checklist). */
  listModelsForProvider(providerId: string): PiModelOption[];

  /** Move legacy env/file provider secrets into Obsidian keychain. */
  migrateProviderCredentialsToKeychain(
    secretStorage: SyncSecretStore,
    addedProviders: readonly string[],
    environmentVariables: string,
  ): {
    addedProviders: string[];
    environmentVariables: string;
    changed: boolean;
  };
}

export function createPiUiFacades(): PiUiFacades {
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
