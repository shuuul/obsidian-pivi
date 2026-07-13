import type { TabData, TabId } from './types';

/**
 * Owns rebuildable per-tab runtime aggregates separately from persisted tab state.
 * TabData remains the legacy aggregate until the vertical slices move each field
 * behind package snapshots and app adapters.
 */
export class TabRuntimeRegistry {
  private readonly runtimes = new Map<TabId, TabData>();

  get size(): number {
    return this.runtimes.size;
  }

  set(tabId: TabId, runtime: TabData): this {
    this.runtimes.set(tabId, runtime);
    return this;
  }

  get(tabId: TabId): TabData | undefined {
    return this.runtimes.get(tabId);
  }

  has(tabId: TabId): boolean {
    return this.runtimes.has(tabId);
  }

  delete(tabId: TabId): boolean {
    return this.runtimes.delete(tabId);
  }

  clear(): void {
    this.runtimes.clear();
  }

  keys(): MapIterator<TabId> {
    return this.runtimes.keys();
  }

  values(): MapIterator<TabData> {
    return this.runtimes.values();
  }
}
