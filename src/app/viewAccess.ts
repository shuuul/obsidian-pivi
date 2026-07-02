import { VIEW_TYPE_PIVI } from '@pivi/core';
import type { App } from 'obsidian';

import type { PiviView } from '@/ui/chat/view/PiviView';

function isPiviView(view: unknown): view is PiviView {
  return typeof view === 'object' && view !== null && 'getTabManager' in view;
}

/** Find the first Pivi sidebar view (no cached reference on Plugin). */
export function findPiviView(app: App): PiviView | null {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_PIVI);
  return leaves.map((leaf) => leaf.view).find(isPiviView) ?? null;
}

/** All open Pivi sidebar views. */
export function findAllPiviViews(app: App): PiviView[] {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_PIVI);
  return leaves.map((leaf) => leaf.view).filter(isPiviView);
}
