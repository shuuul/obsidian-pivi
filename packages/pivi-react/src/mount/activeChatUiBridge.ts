import type {
  MessageContentAdapters,
  MessagePresentationActions,
  MessageViewportHandle,
} from '../chat/messages/types';
import type { ChatProjectionStore } from '../store';
import {
  type ChatUiSnapshot,
  type ChatUiSnapshotKey,
  ChatUiStore,
  type ChatUiStoreListener,
  createInitialChatUiSnapshot,
} from '../store';

export interface ChatTabPortalTargets {
  readonly welcome: HTMLElement | null;
  readonly queue: HTMLElement | null;
  readonly todo: HTMLElement | null;
  readonly navigation: HTMLElement | null;
  readonly messages: HTMLElement | null;
  readonly messagesViewport: HTMLElement | null;
  readonly composer?: HTMLElement | null;
}

export interface ComposerChromeActions {
  send: () => void;
  stop: () => void;
  setModel: (value: string) => void;
  setMode: (value: string) => void;
  setThinkingBudget: (value: string) => void;
  setThinkingLevel: (value: string) => void;
  toggleExternalPath: (path: string) => void;
  toggleExternalPinned: (path: string) => void;
  removeExternalPath: (path: string) => void;
  addExternalContext: () => void;
}

export interface MessagePresentationRuntime {
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
  readonly loadPreviousPage?: () => Promise<boolean>;
  readonly setViewportHandle?: (handle: MessageViewportHandle | null) => void;
}

/**
 * Runtime-only selector for the active tab's immutable UI snapshot and React-owned portal slots.
 * Portal elements intentionally stay outside the serializable snapshot boundary.
 */
export class ActiveChatUiBridge {
  private activeStore: ChatUiStore | null = null;
  private activeProjectionStore: ChatProjectionStore | null = null;
  private activeStoreUnsubscribe: (() => void) | null = null;
  private targets: ChatTabPortalTargets | null = null;
  private actions: ComposerChromeActions | null = null;
  private messagePresentation: MessagePresentationRuntime | null = null;
  private readonly emptySnapshot = new ChatUiStore(createInitialChatUiSnapshot()).getSnapshot();
  private readonly listeners = new Set<ChatUiStoreListener>();

  readonly getSnapshot = (): ChatUiSnapshot => this.activeStore?.getSnapshot() ?? this.emptySnapshot;
  readonly getProjectionStore = (): ChatProjectionStore | null => this.activeProjectionStore;

  readonly getPortalTargets = (): ChatTabPortalTargets | null => this.targets;
  readonly getComposerActions = (): ComposerChromeActions | null => this.actions;

  readonly getMessagePresentation = (): MessagePresentationRuntime | null => this.messagePresentation;
  readonly subscribe = (listener: ChatUiStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setActive(
    store: ChatUiStore | null,
    projectionStore: ChatProjectionStore | null,
    targets: ChatTabPortalTargets | null,
    actions: ComposerChromeActions | null = null,
    messagePresentation: MessagePresentationRuntime | null = null,
  ): void {
    if (
      this.activeStore === store
      && this.activeProjectionStore === projectionStore
      && this.targets === targets
      && this.actions === actions
      && this.messagePresentation === messagePresentation
    ) return;
    if (this.activeProjectionStore !== projectionStore) {
      this.activeProjectionStore?.setSurfaceActive(false);
      projectionStore?.setSurfaceActive(true);
    }
    this.activeStoreUnsubscribe?.();
    this.activeStoreUnsubscribe = null;
    this.activeStore = store;
    this.activeProjectionStore = projectionStore;
    this.targets = targets;
    this.actions = actions;
    this.messagePresentation = messagePresentation;
    if (store) {
      this.activeStoreUnsubscribe = store.subscribe(changedKeys => this.notify(changedKeys));
    }
    this.notify(new Set());
  }

  dispose(): void {
    this.activeProjectionStore?.setSurfaceActive(false);
    this.activeStoreUnsubscribe?.();
    this.activeStoreUnsubscribe = null;
    this.activeStore = null;
    this.activeProjectionStore = null;
    this.targets = null;
    this.actions = null;
    this.messagePresentation = null;
    this.listeners.clear();
  }

  private notify(changedKeys: ReadonlySet<ChatUiSnapshotKey>): void {
    for (const listener of this.listeners) listener(changedKeys);
  }
}
