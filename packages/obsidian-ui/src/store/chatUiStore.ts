import type { ChatIconSvg, ChatMessage, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import type { TodoVisualizationModel } from '@pivi/pivi-agent-core/tools';
import { useSyncExternalStore } from 'react';

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface QueuedTurnSnapshot {
  readonly content: string;
  readonly imageCount: number;
  readonly hasEditorContext: boolean;
  readonly hasBrowserContext: boolean;
  readonly hasCanvasContext: boolean;
}

export interface ThinkingIndicatorSnapshot {
  readonly text: string;
  readonly className: string;
  readonly elapsedLabel: string;
}

export interface ChatUiSnapshotData {
  messages: ChatMessage[];
  isStreaming: boolean;
  cancelRequested: boolean;
  streamGeneration: number;
  isCreatingSession: boolean;
  isSwitchingSession: boolean;
  hasPendingSessionSave: boolean;
  currentOpenSessionId: string | null;
  queuedTurn: QueuedTurnSnapshot | null;
  currentThinkingContent: string;
  thinkingIndicator: ThinkingIndicatorSnapshot | null;
  usage: UsageInfo | null;
  ignoreUsageUpdates: boolean;
  currentTodoVisualizationModel: TodoVisualizationModel | null;
  needsAttention: boolean;
  autoScrollEnabled: boolean;
  responseStartTime: number | null;
  welcomeGreeting: string | null;
  navigationVisible: boolean;
  composer: ComposerChromeSnapshot;
  externalContext: ExternalContextSnapshot;
}
export interface ExternalContextItemSnapshot {
  readonly path: string;
  readonly displayPath: string;
  readonly checked: boolean;
  readonly pinned: boolean;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}
export interface ExternalContextSnapshot {
  readonly items: readonly ExternalContextItemSnapshot[];
  readonly selectedCount: number;
  readonly availableSelectedCount: number;
}
export interface ComposerOptionSnapshot {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly providerLogoSlug?: string;
  readonly fallbackIcon?: string;
  readonly chatIcon?: DeepReadonly<ChatIconSvg>;
  readonly tokens?: number;
}

export interface ComposerChromeSnapshot {
  readonly canSend: boolean;
  readonly model: string;
  readonly modelOptions: readonly ComposerOptionSnapshot[];
  readonly mode: string | null;
  readonly modeLabel: string | null;
  readonly modeOptions: readonly ComposerOptionSnapshot[];
  readonly modeActiveValue: string | null;
  readonly adaptiveReasoning: boolean;
  readonly thinkingBudget: string;
  readonly thinkingLevel: string;
  readonly thinkingOptions: readonly ComposerOptionSnapshot[];
  readonly defaultReasoningValue: string;
}

export type ChatUiSnapshot = DeepReadonly<ChatUiSnapshotData>;
export type ChatUiSnapshotPatch = Partial<ChatUiSnapshotData>;
export type ChatUiSnapshotKey = keyof ChatUiSnapshotData;
export type ChatUiStoreListener = (changedKeys: ReadonlySet<ChatUiSnapshotKey>) => void;

function cloneSerializableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Chat UI snapshots cannot contain ${typeof value} values`);
  }
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.map(item => cloneSerializableValue(item));
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  const prototypeConstructor = prototype === null
    ? null
    : Reflect.get(prototype as object, 'constructor') as unknown;
  const isPlainObject = prototype === null
    || prototype === Object.prototype
    || (typeof prototypeConstructor === 'function' && prototypeConstructor.name === 'Object');
  if (!isPlainObject) {
    throw new TypeError('Chat UI snapshots can contain only plain objects and arrays');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneSerializableValue(child)]),
  );
}

function cloneSerializable<T>(value: T): T {
  return cloneSerializableValue(value) as T;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

function freezeSnapshot(data: ChatUiSnapshotData): ChatUiSnapshot {
  return deepFreeze(data);
}

export function createInitialChatUiSnapshot(): ChatUiSnapshotData {
  return {
    messages: [],
    isStreaming: false,
    cancelRequested: false,
    streamGeneration: 0,
    isCreatingSession: false,
    isSwitchingSession: false,
    hasPendingSessionSave: false,
    currentOpenSessionId: null,
    queuedTurn: null,
    currentThinkingContent: '',
    thinkingIndicator: null,
    usage: null,
    ignoreUsageUpdates: false,
    currentTodoVisualizationModel: null,
    needsAttention: false,
    autoScrollEnabled: true,
    responseStartTime: null,
    welcomeGreeting: null,
    navigationVisible: false,
    composer: {
      canSend: false,
      model: '',
      modelOptions: [],
      mode: null,
      modeLabel: null,
      modeOptions: [],
      modeActiveValue: null,
      adaptiveReasoning: false,
      thinkingBudget: '',
      thinkingLevel: '',
      thinkingOptions: [],
      defaultReasoningValue: '',
    },
    externalContext: {
      items: [],
      selectedCount: 0,
      availableSelectedCount: 0,
    },
  };
}

/** Immutable external-store boundary consumed by React chat surfaces. */
export class ChatUiStore {
  private snapshot: ChatUiSnapshot;
  private readonly listeners = new Set<ChatUiStoreListener>();

  constructor(initial: ChatUiSnapshotData = createInitialChatUiSnapshot()) {
    this.snapshot = freezeSnapshot(cloneSerializable(initial));
  }

  readonly getSnapshot = (): ChatUiSnapshot => this.snapshot;

  readonly subscribe = (listener: ChatUiStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: ChatUiSnapshotPatch): void {
    const changedKeys = new Set(Object.keys(patch) as ChatUiSnapshotKey[]);
    if (changedKeys.size === 0) return;

    const clonedPatch = deepFreeze(cloneSerializable(patch));
    this.snapshot = freezeSnapshot({
      ...(this.snapshot as ChatUiSnapshotData),
      ...(clonedPatch as ChatUiSnapshotPatch),
    });
    for (const listener of this.listeners) {
      listener(changedKeys);
    }
  }
}

export function useChatUiSnapshot(store: ChatUiStore): ChatUiSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
