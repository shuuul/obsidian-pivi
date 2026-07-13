import { VIEW_TYPE_PIVI } from '@pivi/pivi-agent-core/foundation';
import type { App } from 'obsidian';

import type { PiviViewHost } from '@/app/ui/PiviViewHost';

function isPiviView(view: unknown): view is PiviViewHost {
  return typeof view === 'object' && view !== null && 'getTabManager' in view;
}

/** Find the first Pivi sidebar view (no cached reference on Plugin). */
export function findPiviView(app: App): PiviViewHost | null {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_PIVI);
  return leaves.map((leaf) => leaf.view).find(isPiviView) ?? null;
}

/** All open Pivi sidebar views. */
export function findAllPiviViews(app: App): PiviViewHost[] {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_PIVI);
  return leaves.map((leaf) => leaf.view).filter(isPiviView);
}
