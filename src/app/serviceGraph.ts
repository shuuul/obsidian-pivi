import {
  SharedStorageService,
} from "@pivi/obsidian-host";
import { PiSessionStore } from "@pivi/pivi-agent-core/engine/pi/session/piSessionStore";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type {
  DeviceLocalExternalContextStore,
  SessionStore,
} from "@pivi/pivi-agent-core/session";
import { assertBundledReactRuntime } from "@pivi/pivi-react";

import type { ObsidianDeviceLocalExternalContextStore } from "@/app/deviceLocalExternalContextStore";
import { ObsidianDeviceLocalProviderStore } from "@/app/deviceLocalProviderStore";
import { t } from "@/app/i18n";
import { createPiviSettingsCodec } from "@/app/settings/piviSettingsCodec";
import { createPiWorkspaceServices, type PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices"
import type PiviPlugin from "@/main"

export interface PiviServiceGraph {
  piWorkspace: PiWorkspaceServices;
}

export function createSharedStorage(
  plugin: PiviPlugin,
  externalContexts: ObsidianDeviceLocalExternalContextStore,
): SharedStorageService {
  return new SharedStorageService(plugin, createPiviSettingsCodec(
    externalContexts,
    new ObsidianDeviceLocalProviderStore(plugin.app),
  ), {
    failedSaveTabLayout: t("host.failedSaveTabLayout"),
    failedSaveDeletedSessions: t("host.failedSaveDeletedSessions"),
    failedSaveSyncedSettings: t("host.failedSaveSyncedSettings"),
  });
}

export function createSessionStore(
  vaultAdapter: FileStore,
  vaultPath: string,
  externalContexts: DeviceLocalExternalContextStore,
): SessionStore {
  return new PiSessionStore(vaultAdapter, vaultPath, externalContexts);
}

export async function createPluginServiceGraph(
  plugin: PiviPlugin,
): Promise<PiviServiceGraph> {
  assertBundledReactRuntime();
  const vaultAdapter = plugin.storage.getAdapter();
  const piWorkspace = await createPiWorkspaceServices({
    host: plugin,
    vaultAdapter,
  });

  return { piWorkspace };
}
