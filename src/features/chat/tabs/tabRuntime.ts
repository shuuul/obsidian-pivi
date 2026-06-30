import { AgentServices } from '../../../core/agent/AgentServices';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { OpenSessionState } from '../../../core/types';
import type PiviPlugin from '../../../main';
import type { TabData } from './types';

export function isClosingLifecycleState(state: TabData['lifecycleState']): boolean {
  return state === 'closing';
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
  if (tab.lifecycleState === 'closing') {
    return;
  }

  const openSession = openSessionOverride ?? (
    tab.openSessionId
      ? await plugin.getOpenSessionById(tab.openSessionId, tab.leafId)
      : null
  );
  if (tab.serviceInitialized && tab.service) {
    return;
  }

  let service: ChatRuntime | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    if (typeof previousService?.cleanup === 'function') {
      previousService.cleanup();
    }
    tab.service = null;
    tab.serviceInitialized = false;

    const runtime = AgentServices.createChatRuntime({ plugin });
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (openSession) {
      const hasMessages = openSession.messages.length > 0;
      const externalContextPaths = hasMessages
        ? openSession.externalContextPaths || []
        : (plugin.settings.persistentExternalContextPaths || []);

      runtime.syncOpenSessionState(openSession, externalContextPaths);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      service?.cleanup();
      return;
    }

    tab.service = service;
    tab.serviceInitialized = true;

    if (tab.lifecycleState === 'blank') {
      tab.draftModel = null;
    }
    tab.lifecycleState = 'bound_active';
  } catch (error) {
    unsubscribeReadyState?.();
    service?.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;
    throw error;
  }
}
