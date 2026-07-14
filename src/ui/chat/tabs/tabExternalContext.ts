import type { PiChatService } from '@pivi/pivi-agent-core/runtime';

import type { TabData } from './types';

interface SyncTabSessionOptions {
  service?: PiChatService | null;
  resetSelection?: boolean;
}

/**
 * Synchronizes a runtime session with the tab's effective external roots.
 * Session changes reset ephemeral choices; runtime restarts preserve them.
 */
export function syncTabSessionExternalContext(
  tab: TabData,
  session: { sessionFile: string | null } | null,
  defaultPaths: readonly string[],
  options: SyncTabSessionOptions = {},
): string[] {
  const fallbackPaths = [...defaultPaths];
  if (options.resetSelection) {
    tab.ui.externalContextSelector?.resetForSession(fallbackPaths);
  }

  const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
    ?? fallbackPaths;
  const service = options.service === undefined ? tab.service : options.service;
  service?.syncSession(session, externalContextPaths);
  return externalContextPaths;
}
