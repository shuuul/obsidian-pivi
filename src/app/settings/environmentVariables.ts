import { isSecretStorageAvailable } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import type { OpenSessionState, PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type {
  DeviceLocalEnvironmentStore,
  EnvironmentEntryDraft,
  EnvironmentUiEntry,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import {
  buildEntriesFromLegacyText,
  clearObsoleteEnvironmentSecrets,
  createSecretStoreResolveHost,
  environmentStatesEqual,
  extractCanonicalCredentialCandidates,
  projectEnvironmentOntoSettings,
  stageEnvironmentSecrets,
  toEnvironmentUiEntries,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import type { EnvironmentScope } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';

import type { PiviChatCompositionHost } from '@/app/hostContracts';
import {
  migrateCanonicalCredentialsFromText,
  publishEnvironmentEntries,
} from '@/app/settings/deviceLocalEnvironmentMigration';

export interface EnvironmentApplyHooks {
  persistSessionSummary(openSession: OpenSessionState): Promise<void>;
  reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  };
}

type EnvironmentApplyHost = Pick<
  PiviChatCompositionHost,
  'getAllViews' | 'saveSettings'
> & {
  settings: PiviSettings;
  notify(message: string): void;
  app: { secretStorage: SyncSecretStore | undefined };
  getEnvironmentStore(): DeviceLocalEnvironmentStore;
};

interface SecretMutation {
  id: string;
  previous: string | null;
  next: string | null;
}

interface PreparedImport {
  drafts: EnvironmentEntryDraft[];
  credentialMutations: SecretMutation[];
}

const publicationQueues = new WeakMap<object, Promise<void>>();

function enqueuePublication<T extends object>(host: T, operation: () => Promise<void>): Promise<void> {
  const previous = publicationQueues.get(host) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  publicationQueues.set(host, next);
  return next.finally(() => {
    if (publicationQueues.get(host) === next) publicationQueues.delete(host);
  });
}

function getSystemEnvironmentVariable(name: string): string | undefined {
  try {
    return process.env[name];
  } catch {
    return undefined;
  }
}

function createHostResolve(host: EnvironmentApplyHost) {
  const secretStorage = isSecretStorageAvailable(host.app.secretStorage)
    ? host.app.secretStorage
    : undefined;
  return createSecretStoreResolveHost(secretStorage, getSystemEnvironmentVariable);
}

export function getActiveEnvironmentVariables(settings: PiviSettings): string {
  return getRuntimeEnvironmentText(settings);
}

export function getEnvironmentVariablesForScope(
  settings: PiviSettings,
  scope: EnvironmentScope,
): string {
  return getScopedEnvironmentVariables(settings, scope);
}

export function listEnvironmentUiEntries(
  host: EnvironmentApplyHost,
  scope?: EnvironmentScope,
): EnvironmentUiEntry[] {
  const state = host.getEnvironmentStore().loadInitialized();
  if (!state) {
    return [];
  }
  const secretStorage = isSecretStorageAvailable(host.app.secretStorage)
    ? host.app.secretStorage
    : undefined;
  const entries = toEnvironmentUiEntries(state, secretStorage);
  return scope ? entries.filter((entry) => entry.scope === scope) : entries;
}

async function afterEnvironmentPublished(
  plugin: EnvironmentApplyHost,
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  const { changed, invalidatedSessions } = hooks.reconcileModelWithEnvironment();
  await plugin.saveSettings();

  if (invalidatedSessions.length > 0) {
    for (const conv of invalidatedSessions) {
      await hooks.persistSessionSummary(conv);
    }
  }

  let failedTabs = 0;
  for (const view of plugin.getAllViews()) {
    const result = await view.getChatHandle()?.maintenance
      .applyEnvironmentRuntimeChange(changed);
    failedTabs += result?.failedTabs ?? 0;
  }
  if (failedTabs > 0) {
    plugin.notify(
      `Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`,
    );
  }

  for (const openView of plugin.getAllViews()) {
    const maintenance = openView.getChatHandle()?.maintenance;
    maintenance?.invalidateSlashCatalog();
    maintenance?.refreshModelPresentation();
  }

  const noticeText = changed
    ? 'Environment variables applied. Sessions will be rebuilt on next message.'
    : 'Environment variables applied.';
  plugin.notify(noticeText);
}

async function applyEnvironmentEntriesNow(
  plugin: EnvironmentApplyHost,
  drafts: readonly EnvironmentEntryDraft[],
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  publishEnvironmentEntries(plugin.app, plugin.getEnvironmentStore(), drafts);
  const state = plugin.getEnvironmentStore().loadInitialized();
  if (state) {
    projectEnvironmentOntoSettings(plugin.settings, state, createHostResolve(plugin));
  }
  await afterEnvironmentPublished(plugin, hooks);
}

export function applyEnvironmentEntries(
  plugin: EnvironmentApplyHost,
  drafts: readonly EnvironmentEntryDraft[],
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  return enqueuePublication(plugin, () => applyEnvironmentEntriesNow(plugin, drafts, hooks));
}

function preserveEntry(entry: NonNullable<ReturnType<DeviceLocalEnvironmentStore['loadInitialized']>>['entries'][number]): EnvironmentEntryDraft {
  return {
    key: entry.key,
    scope: entry.scope,
    source: entry.source.kind === 'plain'
      ? { kind: 'plain', value: entry.source.value }
      : entry.source.kind === 'secret'
        ? { kind: 'secret' }
        : { kind: 'systemEnvironment', ...(entry.source.name ? { name: entry.source.name } : {}) },
  };
}

function createSecretMutationRecorder(secretStorage: SyncSecretStore): {
  store: SyncSecretStore;
  mutations: Map<string, SecretMutation>;
} {
  const mutations = new Map<string, SecretMutation>();
  const current = (id: string): string | null => mutations.has(id)
    ? mutations.get(id)!.next
    : secretStorage.getSecret(id);
  const record = (id: string, next: string | null): void => {
    const existing = mutations.get(id);
    mutations.set(id, {
      id,
      previous: existing?.previous ?? secretStorage.getSecret(id),
      next,
    });
  };
  return {
    store: {
      getSecret: current,
      setSecret: (id, value) => record(id, value || null),
      listSecrets: prefix => secretStorage.listSecrets(prefix),
      deleteSecret: id => record(id, null),
    },
    mutations,
  };
}

function prepareImports(
  plugin: EnvironmentApplyHost,
  imports: ReadonlyMap<EnvironmentScope, string>,
): PreparedImport {
  const secretStorage = isSecretStorageAvailable(plugin.app.secretStorage)
    ? plugin.app.secretStorage
    : undefined;
  if (!secretStorage) {
    const drafts: EnvironmentEntryDraft[] = [];
    for (const [scope, envText] of imports) {
      const candidates = extractCanonicalCredentialCandidates(envText);
      if (Object.keys(candidates.providerEnv).length || candidates.webCredentials.length) {
        throw new Error('SecretStorage is required to import provider credentials.');
      }
      drafts.push(...(scope === 'shared'
        ? buildEntriesFromLegacyText(envText, '')
        : buildEntriesFromLegacyText('', envText)));
    }
    return { drafts, credentialMutations: [] };
  }
  const recorder = createSecretMutationRecorder(secretStorage);
  const drafts: EnvironmentEntryDraft[] = [];
  for (const [scope, envText] of imports) {
    const migrated = migrateCanonicalCredentialsFromText(
      recorder.store,
      envText,
      plugin.settings.agentSettings.addedProviders ?? [],
      { overwriteWebCredentials: true },
    );
    drafts.push(...(scope === 'shared'
      ? buildEntriesFromLegacyText(migrated.remainingText, '')
      : buildEntriesFromLegacyText('', migrated.remainingText)));
  }
  return { drafts, credentialMutations: [...recorder.mutations.values()] };
}

function commitCredentialMutations(
  secretStorage: SyncSecretStore,
  mutations: readonly SecretMutation[],
): void {
  for (const mutation of mutations) {
    if (mutation.next === null) {
      if (secretStorage.deleteSecret) secretStorage.deleteSecret(mutation.id);
      else secretStorage.setSecret(mutation.id, '');
    } else secretStorage.setSecret(mutation.id, mutation.next);
  }
}

function rollbackCredentialMutations(
  secretStorage: SyncSecretStore,
  mutations: readonly SecretMutation[],
): void {
  for (const mutation of [...mutations].reverse()) {
    try {
      if (mutation.previous === null) {
        if (secretStorage.deleteSecret) secretStorage.deleteSecret(mutation.id);
        else secretStorage.setSecret(mutation.id, '');
      } else {
        secretStorage.setSecret(mutation.id, mutation.previous);
      }
    } catch {
      // Preserve the publication failure; rollback is necessarily best-effort.
    }
  }
}

/**
 * Bulk-import KEY=VALUE text into structured entries for one scope, preserving
 * other scopes. Parses before save; secret-like keys become secret sources.
 */
export async function importEnvironmentText(
  plugin: EnvironmentApplyHost,
  scope: EnvironmentScope,
  envText: string,
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  await enqueuePublication(plugin, async () => {
    const previous = plugin.getEnvironmentStore().loadInitialized();
    const untouched = (previous?.entries ?? [])
      .filter(entry => entry.scope !== scope)
      .map(preserveEntry);
    const prepared = prepareImports(plugin, new Map([[scope, envText]]));
    const secretStorage = plugin.app.secretStorage!;
    try {
      commitCredentialMutations(secretStorage, prepared.credentialMutations);
      await applyEnvironmentEntriesNow(plugin, [...untouched, ...prepared.drafts], hooks);
    } catch (error) {
      rollbackCredentialMutations(secretStorage, prepared.credentialMutations);
      throw error;
    }
  });
}

/** Bulk text apply that parses into structured entries before save. */
export async function applyEnvironmentVariablesBatch(
  plugin: EnvironmentApplyHost,
  updates: Array<{ scope: EnvironmentScope; envText: string }>,
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  await enqueuePublication(plugin, async () => {
    const store = plugin.getEnvironmentStore();
    const previous = store.loadInitialized();
    const byScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      byScope.set(update.scope, update.envText);
    }

    const prepared = prepareImports(plugin, byScope);
    const drafts: EnvironmentEntryDraft[] = (previous?.entries ?? [])
      .filter(entry => !byScope.has(entry.scope))
      .map(preserveEntry);
    drafts.push(...prepared.drafts);
    const secretStorage = isSecretStorageAvailable(plugin.app.secretStorage)
      ? plugin.app.secretStorage
      : undefined;
    if (!secretStorage) {
      throw new Error('SecretStorage is required to save environment configuration.');
    }
    const staged = stageEnvironmentSecrets(secretStorage, drafts, previous);
    try {
      commitCredentialMutations(secretStorage, prepared.credentialMutations);
      if (
        previous
        && environmentStatesEqual(previous, staged.nextState)
        && staged.stagedSecretIds.length === 0
        && staged.obsoleteSecretIds.length === 0
      ) {
        await plugin.saveSettings();
        return;
      }
      store.save(staged.nextState);
      projectEnvironmentOntoSettings(plugin.settings, staged.nextState, createHostResolve(plugin));
      await afterEnvironmentPublished(plugin, hooks);
      clearObsoleteEnvironmentSecrets(secretStorage, staged.obsoleteSecretIds);
    } catch (error) {
      rollbackCredentialMutations(secretStorage, prepared.credentialMutations);
      throw error;
    }
  });
}
