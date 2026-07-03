import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime';

import type PiviPlugin from '@/app/PiviPluginHost';

import type { TabData } from "./types";

export function isClosingLifecycleState(
  state: TabData["lifecycleState"],
): boolean {
  return state === "closing";
}

/**
 * Initializes the tab's chat runtime for the send path.
 *
 * This is the ONLY place a runtime is created. Called from:
 * - ensureServiceInitialized() in InputController.sendMessage()
 *
 * Session sync is passive (state update only). The runtime is started
 * on demand by query() inside the send path.
 */
export async function initializeTabService(
  tab: TabData,
  plugin: PiviPlugin,
  openSessionOverride?: OpenSessionState | null,
): Promise<void> {
  if (tab.lifecycleState === "closing") {
    return;
  }

  const openSession =
    openSessionOverride ??
    (tab.openSessionId
      ? await plugin.getOpenSessionById(tab.openSessionId)
      : null);
  if (tab.serviceInitialized && tab.service) {
    return;
  }

  let service: PiChatService | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    if (typeof previousService?.cleanup === "function") {
      previousService.cleanup();
    }
    tab.service = null;
    tab.serviceInitialized = false;

    const workspace = plugin.getPiWorkspace();
    const runtime = new PiChatRuntime(
      plugin,
      {
        httpClient: plugin.httpClient,
        mcpFetch: nodeFetch,
        mcpProcessEnv: process.env,
      },
      workspace?.mcpServerManager ?? null,
      workspace?.mcpOAuth ?? null,
      getBaseToolProvider(workspace),
    );
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (openSession) {
      const hasMessages = openSession.messages.length > 0;
      const externalContextPaths = hasMessages
        ? openSession.externalContextPaths || []
        : plugin.settings.persistentExternalContextPaths || [];

      runtime.syncSession(openSession ? { sessionFile: openSession.sessionFile ?? null } : null, externalContextPaths);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      service?.cleanup();
      return;
    }

    tab.service = service;
    tab.serviceInitialized = true;

    if (tab.lifecycleState === "blank") {
      tab.draftModel = null;
    }
    tab.lifecycleState = "bound_active";
  } catch (error) {
    unsubscribeReadyState?.();
    service?.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;
    throw error;
  }
}

function getBaseToolProvider(
  workspace: ReturnType<PiviPlugin["getPiWorkspace"]>,
) {
  return workspace?.baseToolProvider ?? null;
}
