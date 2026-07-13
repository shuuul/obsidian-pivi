import type { OpenSessionState, PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { EnvironmentScope } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';

import type { PiviChatCompositionHost } from '@/app/hostContracts';

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
};

function environmentChangesAffectRuntime(scopes: EnvironmentScope[]): boolean {
  return scopes.some((scope) => scope === 'shared' || scope === 'agent');
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

export async function applyEnvironmentVariablesBatch(
  plugin: EnvironmentApplyHost,
  updates: Array<{ scope: EnvironmentScope; envText: string }>,
  hooks: EnvironmentApplyHooks,
): Promise<void> {
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
  for (const update of updates) {
    nextEnvironmentByScope.set(update.scope, update.envText);
  }

  const changedScopes: EnvironmentScope[] = [];
  for (const [scope, envText] of nextEnvironmentByScope) {
    const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
    if (currentValue !== envText) {
      changedScopes.push(scope);
    }
    setEnvironmentVariablesForScope(settingsBag, scope, envText);
  }

  if (changedScopes.length === 0) {
    await plugin.saveSettings();
    return;
  }

  const affectsRuntime = environmentChangesAffectRuntime(changedScopes);
  const { changed, invalidatedSessions } = hooks.reconcileModelWithEnvironment();
  await plugin.saveSettings();

  if (invalidatedSessions.length > 0) {
    for (const conv of invalidatedSessions) {
      await hooks.persistSessionSummary(conv);
    }
  }

  let failedTabs = 0;
  if (affectsRuntime) {
    for (const view of plugin.getAllViews()) {
      const result = await view.getChatHandle()?.maintenance
        .applyEnvironmentRuntimeChange(changed);
      failedTabs += result?.failedTabs ?? 0;
    }
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
