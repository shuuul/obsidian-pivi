import type { App } from "obsidian";

const slashBadgeNavigators = new WeakMap<App, (name: string) => Promise<void>>();

/** Settings composition owns slash destinations; shared badge adapters only request navigation. */
export function registerSlashBadgeNavigation(app: App, navigate: (name: string) => Promise<void>): () => void {
  slashBadgeNavigators.set(app, navigate);
  return () => {
    if (slashBadgeNavigators.get(app) === navigate) slashBadgeNavigators.delete(app);
  };
}

export async function navigateSlashBadge(app: App, name: string): Promise<void> {
  await slashBadgeNavigators.get(app)?.(name);
}
