import {
  SharedStorageService,
} from "@pivi/obsidian-host";
import { isSecretStorageAvailable } from "@pivi/pivi-agent-core/auth/providerSecretStorage";
import { PiSessionStore } from "@pivi/pivi-agent-core/engine/pi/session/piSessionStore";
import { configureSessionJsonlIndexRoot } from "@pivi/pivi-agent-core/engine/pi/session/sessionJsonlIndex";
import { reconcileSessionJournal } from "@pivi/pivi-agent-core/engine/pi/session/sessionRecovery";
import {
  bindSessionJournal,
} from "@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore";
import { createSecretStoreResolveHost } from "@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState";
import { PluginLogger } from "@pivi/pivi-agent-core/foundation/pluginLogger";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type {
  DeviceLocalExternalContextStore,
  SessionStore,
} from "@pivi/pivi-agent-core/session";
import {
  type SessionJournalStore,
  SessionJournalVersionError,
} from "@pivi/pivi-agent-core/session/sessionJournal";
import { assertBundledReactRuntime } from "@pivi/pivi-react";
import { createHash } from 'crypto';
import type { App } from "obsidian";
import { Notice } from "obsidian";
import { homedir } from 'os';
import { join } from 'path';

import { ObsidianDeviceLocalEnvironmentStore } from "@/app/deviceLocalEnvironmentStore";
import type { ObsidianDeviceLocalExternalContextStore } from "@/app/deviceLocalExternalContextStore";
import { ObsidianDeviceLocalProviderStore } from "@/app/deviceLocalProviderStore";
import { ObsidianDeviceLocalSessionJournalStore } from "@/app/deviceLocalSessionJournalStore";
import { t } from "@/app/i18n";
import { createPiviSettingsCodec } from "@/app/settings/piviSettingsCodec";
import { createPiWorkspaceServices, type PiWorkspaceServices } from "@/app/workspace/PiWorkspaceServices"
import type PiviPlugin from "@/main"

const logger = new PluginLogger('ServiceGraph');

export interface PiviServiceGraph {
  piWorkspace: PiWorkspaceServices;
}

export function createSharedStorage(
  plugin: PiviPlugin,
  externalContexts: ObsidianDeviceLocalExternalContextStore,
): SharedStorageService {
  const environmentStore = new ObsidianDeviceLocalEnvironmentStore(plugin.app);
  return new SharedStorageService(plugin, createPiviSettingsCodec(
    externalContexts,
    new ObsidianDeviceLocalProviderStore(plugin.app),
    {
      loadInitialized: () => environmentStore.loadInitialized(),
      createResolveHost: () => createSecretStoreResolveHost(
        isSecretStorageAvailable(plugin.app.secretStorage)
          ? plugin.app.secretStorage
          : undefined,
        (name) => {
          try {
            return process.env[name];
          } catch {
            return undefined;
          }
        },
      ),
    },
  ), {
    failedSaveTabLayout: t("host.failedSaveTabLayout"),
    failedSaveDeletedSessions: t("host.failedSaveDeletedSessions"),
    failedSaveSyncedSettings: t("host.failedSaveSyncedSettings"),
  });
}

/** Device-local index root outside synced `.pivi/` (home cache keyed by vault path). */
export function resolveDeviceLocalSessionIndexRoot(vaultPath: string): string {
  const vaultKey = createHash('sha256').update(vaultPath, 'utf8').digest('hex').slice(0, 16);
  return join(homedir(), '.pivi', 'session-indexes', vaultKey);
}

export function createSessionStore(
  vaultAdapter: FileStore,
  vaultPath: string,
  externalContexts: DeviceLocalExternalContextStore,
  journalStore?: SessionJournalStore | null,
): SessionStore {
  configureSessionJsonlIndexRoot(resolveDeviceLocalSessionIndexRoot(vaultPath));
  if (journalStore) {
    try {
      journalStore.load();
      bindSessionJournal(journalStore);
    } catch (error) {
      if (!(error instanceof SessionJournalVersionError)) {
        throw error;
      }
      bindSessionJournal(null);
      logger.warn('Disabled session journaling for an unsupported journal version', {
        error: error.message,
      });
    }
  }
  return new PiSessionStore(vaultAdapter, vaultPath, externalContexts);
}

export function reconcileSessionCloudRecovery(
  app: App,
  vaultPath: string,
  journalStore: SessionJournalStore = new ObsidianDeviceLocalSessionJournalStore(app),
): void {
  bindSessionJournal(journalStore);
  let results;
  try {
    results = reconcileSessionJournal(vaultPath, journalStore, {
      recoveredTitle: t('host.sessionRecovery.recoveredTitle'),
    });
  } catch (error) {
    if (!(error instanceof SessionJournalVersionError)) {
      throw error;
    }
    bindSessionJournal(null);
    logger.warn('Disabled session recovery for an unsupported journal version', {
      error: error.message,
    });
    return;
  }
  for (const result of results) {
    if (result.noticeKey === 'host.sessionRecovery.recovered' && result.noticeParams) {
      new Notice(t('host.sessionRecovery.recovered', result.noticeParams));
    } else if (result.noticeKey === 'host.sessionRecovery.applied' && result.noticeParams) {
      new Notice(t('host.sessionRecovery.applied', result.noticeParams));
    }
  }
}

export async function createPluginServiceGraph(
  plugin: PiviPlugin,
): Promise<PiviServiceGraph> {
  assertBundledReactRuntime();
  const vaultAdapter = plugin.storage.getAdapter();
  const piWorkspace = await createPiWorkspaceServices({
    host: plugin,
    vaultAdapter,
    network: plugin.network,
  });

  return { piWorkspace };
}
