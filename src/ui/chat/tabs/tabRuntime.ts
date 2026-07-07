import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime';

import type PiviPlugin from '@/app/PiviPluginHost';

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

    const runtime = createTabRuntime(plugin);
    service = runtime;
    subscriptions = registerRuntimeSubscriptions(tab, runtime);

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    syncRuntimeSession(runtime, plugin, openSession);

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      cleanupRuntimeInit(service, subscriptions);
      return;
    }

    tab.service = service;
    tab.serviceInitialized = true;

    if (tab.lifecycleState === "blank") {
      tab.draftModel = null;
    }
    tab.lifecycleState = "bound_active";
  } catch (error) {
    cleanupRuntimeInit(service, subscriptions);
    tab.service = null;
    tab.serviceInitialized = false;
    throw error;
  }
}

async function resolveOpenSession(
  tab: TabData,
  plugin: PiviPlugin,
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

function createTabRuntime(plugin: PiviPlugin): PiChatRuntime {
  const workspace = plugin.getPiWorkspace();
  return new PiChatRuntime(
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
}

function registerRuntimeSubscriptions(tab: TabData, runtime: PiChatRuntime): RuntimeSubscriptions {
  const unsubscribeReadyState = runtime.onReadyStateChange(() => {});
  const unsubscribeSubagentChunks = typeof runtime.onSubagentChunk === "function"
    ? runtime.onSubagentChunk((chunk) => (
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

function syncRuntimeSession(
  runtime: PiChatRuntime,
  plugin: PiviPlugin,
  openSession: OpenSessionState | null,
): void {
  if (!openSession) {
    return;
  }

  const hasMessages = openSession.messages.length > 0;
  const externalContextPaths = hasMessages
    ? openSession.externalContextPaths || []
    : plugin.settings.persistentExternalContextPaths || [];

  runtime.syncSession({ sessionFile: openSession.sessionFile ?? null }, externalContextPaths);
}

function cleanupRuntimeInit(
  service: PiChatService | null,
  subscriptions: RuntimeSubscriptions | null,
): void {
  subscriptions?.cleanup();
  service?.cleanup();
}

function getBaseToolProvider(
  workspace: ReturnType<PiviPlugin["getPiWorkspace"]>,
) {
  return workspace?.baseToolProvider ?? null;
}
