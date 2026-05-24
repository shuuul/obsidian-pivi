import { PiAgentServices } from '../../../core/agent/PiAgentServices';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { Conversation } from '../../../core/types';
import type ObsiusPlugin from '../../../main';
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
  plugin: ObsiusPlugin,
  conversationOverride?: Conversation | null,
): Promise<void> {
  if (tab.lifecycleState === 'closing') {
    return;
  }

  const conversation = conversationOverride ?? (
    tab.conversationId
      ? await plugin.getConversationById(tab.conversationId, tab.leafId)
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

    const runtime = PiAgentServices.createChatRuntime({ plugin });
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (conversation) {
      const hasMessages = conversation.messages.length > 0;
      const externalContextPaths = hasMessages
        ? conversation.externalContextPaths || []
        : (plugin.settings.persistentExternalContextPaths || []);

      runtime.syncConversationState(conversation, externalContextPaths);
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
