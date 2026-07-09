import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime';

import type { PiviChatHost } from '@/app/hostContracts';

import type { TabData } from "./types";

interface RuntimeSubscriptions {
  cleanup: () => void;
}

export function isClosingLifecycleState(
  state: TabData["lifecycleState"],
): boolean {
  return state === "closing";
}

/**
 * Initializes the tab's chat service for the send path.
 *
 * This is the ONLY place a chat service is created in UI. Construction of the
 * concrete PiChatRuntime stays in app composition (`plugin.createChatService`).
 * Called from ensureServiceInitialized() in InputController.sendMessage().
 *
 * Session sync is passive (state update only). The service starts work
 * on demand by query() inside the send path.
 */
export async function initializeTabService(
  tab: TabData,
  plugin: PiviChatHost,
  openSessionOverride?: OpenSessionState | null,
): Promise<void> {
  if (tab.lifecycleState === "closing") {
    return;
  }

  const openSession = await resolveOpenSession(tab, plugin, openSessionOverride);
  if (tab.serviceInitialized && tab.service) {
    return;
  }

  let service: PiChatService | null = null;
  let subscriptions: RuntimeSubscriptions | null = null;
  const previousService = tab.service;

  try {
    cleanupPreviousService(previousService);
    tab.service = null;
    tab.serviceInitialized = false;

    service = plugin.createChatService();
    subscriptions = registerServiceSubscriptions(tab, service);

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    syncServiceSession(service, plugin, openSession);

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      cleanupServiceInit(service, subscriptions);
      return;
    }

    tab.service = service;
    tab.serviceInitialized = true;

    if (tab.lifecycleState === "blank") {
      tab.draftModel = null;
    }
    tab.lifecycleState = "bound_active";
  } catch (error) {
    cleanupServiceInit(service, subscriptions);
    tab.service = null;
    tab.serviceInitialized = false;
    throw error;
  }
}

async function resolveOpenSession(
  tab: TabData,
  plugin: PiviChatHost,
  openSessionOverride?: OpenSessionState | null,
): Promise<OpenSessionState | null> {
  if (openSessionOverride !== undefined) {
    return openSessionOverride;
  }
  return tab.openSessionId
    ? plugin.getOpenSessionById(tab.openSessionId)
    : null;
}

function cleanupPreviousService(previousService: PiChatService | null | undefined): void {
  if (typeof previousService?.cleanup === "function") {
    previousService.cleanup();
  }
}

function registerServiceSubscriptions(tab: TabData, service: PiChatService): RuntimeSubscriptions {
  const unsubscribeReadyState = service.onReadyStateChange(() => {});
  const unsubscribeSubagentChunks = typeof service.onSubagentChunk === "function"
    ? service.onSubagentChunk((chunk) => (
      tab.controllers.streamController?.handleBackgroundSubagentChunk(chunk)
    ))
    : () => {};
  let didCleanup = false;
  const cleanup = () => {
    if (didCleanup) return;
    didCleanup = true;
    unsubscribeReadyState();
    unsubscribeSubagentChunks();
  };
  tab.dom.eventCleanups.push(cleanup);

  return { cleanup };
}

function syncServiceSession(
  service: PiChatService,
  plugin: PiviChatHost,
  openSession: OpenSessionState | null,
): void {
  if (!openSession) {
    return;
  }

  const hasMessages = openSession.messages.length > 0;
  const externalContextPaths = hasMessages
    ? openSession.externalContextPaths || []
    : plugin.settings.persistentExternalContextPaths || [];

  service.syncSession({ sessionFile: openSession.sessionFile ?? null }, externalContextPaths);
}

function cleanupServiceInit(
  service: PiChatService | null,
  subscriptions: RuntimeSubscriptions | null,
): void {
  subscriptions?.cleanup();
  service?.cleanup();
}
