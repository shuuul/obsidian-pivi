import type { WorkspaceLeaf } from 'obsidian';

import type { PiviChatView } from '@/app/hostContracts';

export interface ActivateOpenSessionElsewhereOptions {
  views: readonly PiviChatView[];
  currentLeaf: WorkspaceLeaf;
  openSessionId: string;
  revealLeaf: (leaf: WorkspaceLeaf) => Promise<void>;
}

/** Reveals and activates the first other chat view already bound to a session. */
export async function activateOpenSessionElsewhere({
  currentLeaf,
  openSessionId,
  revealLeaf,
  views,
}: ActivateOpenSessionElsewhereOptions): Promise<boolean> {
  for (const view of views) {
    if (view.leaf === currentLeaf) continue;
    const handle = view.getChatHandle();
    if (!handle?.maintenance.hasSession(openSessionId)) continue;
    await revealLeaf(view.leaf);
    return handle.maintenance.activateSession(openSessionId);
  }
  return false;
}
