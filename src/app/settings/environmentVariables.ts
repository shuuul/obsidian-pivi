import type { OpenSessionState, PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { EnvironmentScope } from '@pivi/pivi-agent-core/foundation/settings';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';

import type { PiviChatHost } from '@/app/hostContracts';
import { getDefaultExternalContextPaths } from '@/ui/shared/utils/defaultExternalContextPaths';

export interface EnvironmentApplyHooks {
  persistSessionSummary(openSession: OpenSessionState): Promise<void>;
  reconcileModelWithEnvironment(): {
    changed: boolean;
    invalidatedSessions: OpenSessionState[];
  };
}

type EnvironmentApplyHost = Pick<
  PiviChatHost,
  'getAllViews' | 'getOpenSessionSync' | 'getView' | 'saveSettings'
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

  const view = plugin.getView();
  const tabManager = view?.getTabManager();

  if (tabManager) {
    const affectedTabs = affectsRuntime ? tabManager.getAllTabs() : [];
    const syncTabRuntimeState = (
      tab: (typeof affectedTabs)[number],
    ): void => {
      if (!tab.service || !tab.serviceInitialized) {
        return;
      }

      const openSession = tab.openSessionId
        ? plugin.getOpenSessionSync(tab.openSessionId)
        : null;
      const externalContextPaths =
        tab.ui.externalContextSelector?.getExternalContexts() ??
        getDefaultExternalContextPaths(plugin.settings);

      tab.service.syncSession(
        openSession ? { sessionFile: openSession.sessionFile ?? null } : null,
        externalContextPaths,
      );
    };

    for (const tab of affectedTabs) {
      if (tab.state.isStreaming) {
        tab.controllers.inputController?.cancelStreaming();
      }
    }

    let failedTabs = 0;
    if (changed) {
      for (const tab of affectedTabs) {
        if (!tab.service || !tab.serviceInitialized) {
          continue;
        }
        try {
          syncTabRuntimeState(tab);
          tab.service.resetSession();
          await tab.service.ensureReady();
        } catch (error) {
          console.warn(
            'Pivi: tab failed to restart after environment change',
            error,
          );
          failedTabs++;
        }
      }
    } else {
      for (const tab of affectedTabs) {
        if (!tab.service || !tab.serviceInitialized) {
          continue;
        }
        try {
          syncTabRuntimeState(tab);
          await tab.service.ensureReady({ force: true });
        } catch (error) {
          console.warn(
            'Pivi: tab failed to refresh after environment change',
            error,
          );
          failedTabs++;
        }
      }
    }
    if (failedTabs > 0) {
      plugin.notify(
        `Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`,
      );
    }
  }

  for (const openView of plugin.getAllViews()) {
    openView.invalidateSlashCommandCaches();
    openView.refreshModelSelector();
  }

  const noticeText = changed
    ? 'Environment variables applied. Sessions will be rebuilt on next message.'
    : 'Environment variables applied.';
  plugin.notify(noticeText);
}
