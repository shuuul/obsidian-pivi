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
  formatEnvironmentMap,
  projectEnvironmentOntoSettings,
  resolveEnvironmentMap,
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
import { publishEnvironmentEntries } from '@/app/settings/deviceLocalEnvironmentMigration';

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

export async function applyEnvironmentEntries(
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
  const store = plugin.getEnvironmentStore();
  const previous = store.loadInitialized();
  const otherScope: EnvironmentScope = scope === 'shared' ? 'agent' : 'shared';
  const otherEntries = (previous?.entries ?? [])
    .filter((entry) => entry.scope === otherScope)
    .map((entry): EnvironmentEntryDraft => ({
      key: entry.key,
      scope: entry.scope,
      source: entry.source.kind === 'plain'
        ? { kind: 'plain', value: entry.source.value }
        : entry.source.kind === 'secret'
          ? { kind: 'secret' }
          : {
              kind: 'systemEnvironment',
              ...(entry.source.name ? { name: entry.source.name } : {}),
            },
    }));

  const imported = scope === 'shared'
    ? buildEntriesFromLegacyText(envText, '')
    : buildEntriesFromLegacyText('', envText);

  await applyEnvironmentEntries(plugin, [...otherEntries, ...imported], hooks);
}

/** Bulk text apply that parses into structured entries before save. */
export async function applyEnvironmentVariablesBatch(
  plugin: EnvironmentApplyHost,
  updates: Array<{ scope: EnvironmentScope; envText: string }>,
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  const store = plugin.getEnvironmentStore();
  const previous = store.loadInitialized();
  const byScope = new Map<EnvironmentScope, string>();
  for (const update of updates) {
    byScope.set(update.scope, update.envText);
  }

  const sharedText = byScope.has('shared')
    ? byScope.get('shared')!
    : formatEnvironmentMap(
      previous
        ? resolveEnvironmentMap(previous, createHostResolve(plugin), 'shared')
        : {},
    );
  const agentText = byScope.has('agent')
    ? byScope.get('agent')!
    : formatEnvironmentMap(
      previous
        ? resolveEnvironmentMap(previous, createHostResolve(plugin), 'agent')
        : {},
    );

  const drafts = buildEntriesFromLegacyText(sharedText, agentText);
  const secretStorage = isSecretStorageAvailable(plugin.app.secretStorage)
    ? plugin.app.secretStorage
    : undefined;
  if (!secretStorage) {
    throw new Error('SecretStorage is required to save environment configuration.');
  }
  const staged = stageEnvironmentSecrets(secretStorage, drafts, previous);
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
}
