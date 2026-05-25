import type { App } from 'obsidian';

import { VIEW_TYPE_OBSIUS } from '../core/types';
import type { ObsiusView } from '../features/chat/ObsiusView';

function isObsiusView(view: unknown): view is ObsiusView {
  return typeof view === 'object' && view !== null && 'getTabManager' in view;
}

/** Find the first Obsius sidebar view (no cached reference on Plugin). */
export function findObsiusView(app: App): ObsiusView | null {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_OBSIUS);
  return leaves.map((leaf) => leaf.view).find(isObsiusView) ?? null;
}

/** All open Obsius sidebar views. */
export function findAllObsiusViews(app: App): ObsiusView[] {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_OBSIUS);
  return leaves.map((leaf) => leaf.view).filter(isObsiusView);
}
