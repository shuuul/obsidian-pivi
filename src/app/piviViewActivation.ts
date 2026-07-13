import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import type { ChatViewPlacement } from "@pivi/pivi-agent-core/foundation/settings";
import type { App, WorkspaceLeaf } from "obsidian";

import type { PiviChatView } from "@/app/hostContracts";
import { findPiviView } from "@/app/viewAccess";
import { revealWorkspaceLeaf } from "@/ui/shared/utils/obsidianCompat";

function getLeafForPlacement(
  app: App,
  placement: ChatViewPlacement,
): WorkspaceLeaf | null {
  const { workspace } = app;
  switch (placement) {
    case "main-tab":
      return workspace.getLeaf("tab");
    case "left-sidebar":
      return workspace.getLeftLeaf(false);
    case "right-sidebar":
      return workspace.getRightLeaf(false);
  }
}

export async function activatePiviView(
  app: App,
  placement: ChatViewPlacement,
): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(VIEW_TYPE_PIVI)[0];

  if (!leaf) {
    const newLeaf = getLeafForPlacement(app, placement);
    if (newLeaf) {
      await newLeaf.setViewState({
        type: VIEW_TYPE_PIVI,
        active: true,
      });
      leaf = newLeaf;
    }
  }

  if (leaf) {
    await revealWorkspaceLeaf(workspace, leaf);
  }
}

export function canCreatePiviTab(app: App): boolean {
  const hasPiviLeaf = app.workspace.getLeavesOfType(VIEW_TYPE_PIVI).length > 0;
  const view = findPiviView(app);
  const commands = view?.getChatHandle()?.commands;

  if (commands) {
    return commands.getState().canCreateTab;
  }

  if (hasPiviLeaf) {
    return false;
  }

  return true;
}

export async function ensurePiviViewOpen(
  app: App,
  placement: ChatViewPlacement,
): Promise<PiviChatView | null> {
  const existingView = findPiviView(app);
  if (existingView) {
    return existingView;
  }

  await activatePiviView(app, placement);
  return findPiviView(app);
}

/**
 * Open a new chat tab, avoiding an extra blank tab when cold-opening a view
 * that already restores its initial tab.
 */
export async function openPiviNewTab(
  app: App,
  placement: ChatViewPlacement,
  lastKnownTabManagerState: AppTabManagerState | null,
): Promise<void> {
  const existingView = findPiviView(app);
  if (existingView) {
    await existingView.getChatHandle()?.commands.createTab();
    return;
  }

  const restoredTabCount = lastKnownTabManagerState?.openTabs.length ?? 0;
  const view = await ensurePiviViewOpen(app, placement);
  if (!view) {
    return;
  }

  if (restoredTabCount === 0) {
    return;
  }

  await view.getChatHandle()?.commands.createTab();
}
