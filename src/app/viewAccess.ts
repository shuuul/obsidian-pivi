import { VIEW_TYPE_PIVI } from '@pivi/pivi-agent-core/foundation';
import type { App } from 'obsidian';

import type { PiviChatView } from '@/app/hostContracts';

function isPiviView(view: unknown): view is PiviChatView {
  return typeof view === 'object'
    && view !== null
    && 'leaf' in view
    && 'getChatHandle' in view
    && typeof view.getChatHandle === 'function';
}

/** Find the first Pivi sidebar view (no cached reference on Plugin). */
export function findPiviView(app: App): PiviChatView | null {
  for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_PIVI)) {
    const view: unknown = leaf.view;
    if (isPiviView(view)) return view;
  }
  return null;
}

/** All open Pivi sidebar views. */
export function findAllPiviViews(app: App): PiviChatView[] {
  const views: PiviChatView[] = [];
  for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_PIVI)) {
    const view: unknown = leaf.view;
    if (isPiviView(view)) views.push(view);
  }
  return views;
}
