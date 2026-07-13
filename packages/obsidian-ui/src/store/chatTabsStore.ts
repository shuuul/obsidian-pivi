import type { ChatIconSvg } from '@pivi/pivi-agent-core/foundation';

export interface ChatTabSnapshotItem {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly isActive: boolean;
  readonly isStreaming: boolean;
  readonly needsAttention: boolean;
  readonly isArchived: boolean;
  readonly canClose: boolean;
}

export type ChatTabBarPosition = 'input' | 'header';

export interface ChatTabsSnapshot {
  readonly items: readonly ChatTabSnapshotItem[];
  readonly position: ChatTabBarPosition;
  readonly chatIcon: ChatIconSvg | null;
}

export interface ChatTabActions {
  switchTab(id: string): Promise<void> | void;
  archiveTab(id: string): Promise<void> | void;
  renameTab(id: string, title: string): Promise<void> | void;
  closeTab(id: string): Promise<void> | void;
  startNewChat(): Promise<void> | void;
}

function freezeSnapshot(snapshot: ChatTabsSnapshot): ChatTabsSnapshot {
  return Object.freeze({
    ...snapshot,
    items: Object.freeze(snapshot.items.map(item => Object.freeze({ ...item }))),
  });
}

/** External store for the React-owned tab shell. Runtime objects stay in app registries. */
export class ChatTabsStore {
  private snapshot: ChatTabsSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(snapshot: ChatTabsSnapshot) {
    this.snapshot = freezeSnapshot(snapshot);
  }

  readonly getSnapshot = (): ChatTabsSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(snapshot: ChatTabsSnapshot): void {
    this.snapshot = freezeSnapshot(snapshot);
    for (const listener of this.listeners) listener();
  }
}
