import {
  SharedStorageService,
} from "@pivi/obsidian-host";
import { PiSessionStore } from "@pivi/pivi-agent-core/engine/pi/session/piSessionStore";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type { SessionStore } from "@pivi/pivi-agent-core/session";
import { assertBundledReactRuntime } from "@pivi/pivi-react";

import { t } from "@/app/i18n";
import { createPiviSettingsCodec } from "@/app/settings/piviSettingsCodec";
import { createPiWorkspaceServices, type PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices"
import type PiviPlugin from "@/main"

export interface PiviServiceGraph {
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
  assertBundledReactRuntime();
  const vaultAdapter = plugin.storage.getAdapter();
  const piWorkspace = await createPiWorkspaceServices({
    host: plugin,
    vaultAdapter,
  });

  return { piWorkspace };
}
