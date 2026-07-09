import {
  getVaultPath,
  HomeFileAdapter,
  type ObsidianHost,
  ObsidianVaultApi,
  SharedStorageService,
} from "@pivi/obsidian-host";
import { PiSessionStore } from "@pivi/pivi-agent-core/engine/pi/session/piSessionStore";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type { SessionStore } from "@pivi/pivi-agent-core/session";

import { createPiviSettingsCodec } from "@/app/settings/piviSettingsCodec";
import { createPiWorkspaceServices, type PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices"
import { t } from "@/i18n";
import type PiviPlugin from "@/main"
import { piSettingsTabRenderer } from "@/ui/settings/PiSettingsTab";

export interface PiviServiceGraph {
  obsidianHost: ObsidianHost;
  piWorkspace: PiWorkspaceServices;
}

export function createSharedStorage(plugin: PiviPlugin): SharedStorageService {
  return new SharedStorageService(plugin, createPiviSettingsCodec(), {
    failedSaveTabLayout: t("host.failedSaveTabLayout"),
    failedSaveDeletedSessions: t("host.failedSaveDeletedSessions"),
  });
}

export function createSessionStore(
  vaultAdapter: FileStore,
  vaultPath: string,
): SessionStore {
  return new PiSessionStore(vaultAdapter, vaultPath);
}

export async function createPluginServiceGraph(
  plugin: PiviPlugin,
): Promise<PiviServiceGraph> {
  const vaultAdapter = plugin.storage.getAdapter();
  const homeAdapter = new HomeFileAdapter();
  const obsidianHost: ObsidianHost = {
    vaultApi: new ObsidianVaultApi(plugin.app),
    vaultFileStore: vaultAdapter,
    homeFileStore: homeAdapter,
    sharedStorage: plugin.storage as SharedStorageService,
    secretStore: plugin.app.secretStorage,
    vaultPath: getVaultPath(plugin.app),
    vaultName: plugin.app.vault.getName(),
  };
  const piWorkspace = await createPiWorkspaceServices(
    {
      host: plugin.getAgentHostContext(),
      storage: plugin.storage,
      vaultAdapter,
      homeAdapter,
    },
    {
      // Composition root injects UI settings renderer; workspace stays UI-free.
      settingsTabRenderer: piSettingsTabRenderer,
    },
  );

  return { obsidianHost, piWorkspace };
}
