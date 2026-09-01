import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import { VIEW_TYPE_PIVI } from '@pivi/agent/runtime';
import type { App } from 'obsidian';

import type { PiviChatView } from '@/app/hostContracts';

const logger = new PluginLogger('PiviViewAccess');

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

/** Refresh all open views without turning one disposed view into a failed commit. */
export async function refreshVaultSkillsViews(
  views: readonly PiviChatView[],
): Promise<void> {
  for (const view of views) {
    try {
      await view.getChatHandle()?.maintenance.refreshVaultSkills();
    } catch (error) {
      // Skill publication is already durable when this notification runs.
      logger.warn('Failed to refresh vault skills in a Pivi view', error);
    }
  }
}

export async function refreshPiviManagementViews(
  views: readonly PiviChatView[],
  domain: 'mcp' | 'skills' | 'commands' | 'prompt',
): Promise<readonly { readonly target: string; readonly message: string }[]> {
  const failures: Array<{ target: string; message: string }> = [];
  for (let index = 0; index < views.length; index++) {
    const maintenance = views[index]!.getChatHandle()?.maintenance;
    const viewTarget = `view:${String(index + 1)}`;
    if (!maintenance?.refreshPiviManagement) {
      failures.push({ target: viewTarget, message: 'View refresh unavailable.' });
      continue;
    }
    try {
      for (const entry of await maintenance.refreshPiviManagement(domain)) {
        failures.push({
          target: entry.target.startsWith('tab:') ? `${viewTarget}/${entry.target}` : entry.target,
          message: entry.message,
        });
      }
    } catch {
      failures.push({ target: viewTarget, message: 'Runtime refresh failed.' });
    }
  }
  return failures.slice(0, 20);
}
