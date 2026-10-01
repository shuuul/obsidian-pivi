import type { ChatMessage } from '@pivi/agent/runtime/chatTypes';
import type { ToolCallInfo } from '@pivi/agent/tools';

import {
  type ChatPerfProjectionCommitReason,
  type ChatPerfProjectionEventType,
  type ChatPerfRecorder,
  NOOP_CHAT_PERF_RECORDER,
} from './chatPerfRecorder';
import {
  type ChatBlockEntity,
  type ChatProjectionDiagnosticListener,
  type ChatProjectionEvent,
  type ChatToolEntity,
  getChatProjectionBlockId,
  type MessageEntityKeys,
  NOOP_PROJECTION_DIAGNOSTIC_LISTENER,
  type ProjectionListener,
  type ProjectionMessage,
} from './chatProjectionEvents';
import type { DeepReadonly } from './chatUiStore';
export {
  type ChatBlockEntity,
  type ChatProjectionDiagnostic,
  type ChatProjectionDiagnosticCode,
  type ChatProjectionDiagnosticListener,
  type ChatProjectionEvent,
  type ChatProjectionEventMetadata,
  type ChatProjectionMessageChange,
  type ChatToolEntity,
  getChatProjectionBlockId,
} from './chatProjectionEvents';
export {
  useChatProjectionBlock,
  useChatProjectionMessageStructure,
  useChatProjectionOrder,
  useChatProjectionTool,
  useChatProjectionTools,
} from './chatProjectionHooks';
import { ChatProjectionEventGate } from './chatProjectionEventGate';
import {
  deepFreeze,
  messageStructuresEqual,
  snapshotMessage,
  structurallyEqual,
  toolEntitiesEqual,
} from './chatProjectionSnapshots';

export const CHAT_PROJECTION_PAGE_SIZE = 100;
export const CHAT_PROJECTION_HIDDEN_CADENCE_MS = 250;

/**
 * Entity-addressable React read model for chat messages.
 *
 * Durable ChatMessage objects remain owned by ChatState. This store snapshots
 * only projected messages and can coalesce repeated mutations of one message
 * into a single animation-frame publication.
 */
export class ChatProjectionStore {
  private order: readonly string[] = Object.freeze([]);
  private readonly messages = new Map<string, ProjectionMessage>();
  private readonly messageStructures = new Map<string, ProjectionMessage>();
  private readonly blocks = new Map<string, DeepReadonly<ChatBlockEntity>>();
  private readonly tools = new Map<string, DeepReadonly<ChatToolEntity>>();
  private readonly entityKeysByMessageId = new Map<string, MessageEntityKeys>();
  private sourceMessages: readonly ChatMessage[] = [];
  private projectedStart = 0;
  private ownerWindow: Window | null = null;
  private surfaceActive = true;
  private pendingFrame: number | null = null;
  private pendingTimer: number | null = null;
  private pendingPaintFrame: number | null = null;
  private readonly pendingMessages = new Map<string, ProjectionMessage>();
  private readonly eventGate: ChatProjectionEventGate;
  private readonly orderListeners = new Set<ProjectionListener>();
  private readonly messageListeners = new Map<string, Set<ProjectionListener>>();
  private readonly messageStructureListeners = new Map<string, Set<ProjectionListener>>();
  private readonly blockListeners = new Map<string, Set<ProjectionListener>>();
  private readonly toolListeners = new Map<string, Set<ProjectionListener>>();

  constructor(
    readonly perfRecorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER,
    onDiagnostic: ChatProjectionDiagnosticListener = NOOP_PROJECTION_DIAGNOSTIC_LISTENER,
  ) {
    this.eventGate = new ChatProjectionEventGate(
      onDiagnostic,
      messageId => this.pendingMessages.has(messageId) || this.messages.has(messageId),
    );
  }

  readonly getOrderSnapshot = (): readonly string[] => this.order;

  getMessageSnapshot = (messageId: string): ProjectionMessage | null => (
    this.messages.get(messageId) ?? null
  );

  getMessageStructureSnapshot = (messageId: string): ProjectionMessage | null => (
    this.messageStructures.get(messageId) ?? null
  );

  getBlockSnapshot = (blockId: string): DeepReadonly<ChatBlockEntity> | null => (
    this.blocks.get(blockId) ?? null
  );

  getToolSnapshot = (toolId: string): DeepReadonly<ChatToolEntity> | null => (
    this.tools.get(toolId) ?? null
  );

  subscribeOrder = (listener: ProjectionListener): (() => void) => {
    this.orderListeners.add(listener);
    return () => this.orderListeners.delete(listener);
  };

  subscribeMessage(messageId: string, listener: ProjectionListener): () => void {
    let listeners = this.messageListeners.get(messageId);
    if (!listeners) {
      listeners = new Set();
      this.messageListeners.set(messageId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.messageListeners.delete(messageId);
    };
  }

  subscribeMessageStructure(messageId: string, listener: ProjectionListener): () => void {
    return this.subscribeEntity(this.messageStructureListeners, messageId, listener);
  }

  subscribeBlock = (blockId: string, listener: ProjectionListener): (() => void) => (
    this.subscribeEntity(this.blockListeners, blockId, listener)
  );

  subscribeTool = (toolId: string, listener: ProjectionListener): (() => void) => (
    this.subscribeEntity(this.toolListeners, toolId, listener)
  );

  setOwnerWindow(ownerWindow: Window | null): void {
    // An unmounted inactive surface keeps its last realm so hidden work stays throttled.
    if (!ownerWindow || ownerWindow === this.ownerWindow) return;
    this.cancelScheduledPublication();
    this.cancelPaintFrame();
    this.ownerWindow?.document?.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.ownerWindow = ownerWindow;
    ownerWindow.document?.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.schedulePendingPublication();
  }

  setSurfaceActive(active: boolean): void {
    if (active === this.surfaceActive) return;
    this.surfaceActive = active;
    this.rescheduleForCadenceChange();
  }

  /** The sole production ingestion boundary for message projection changes. */
  dispatch(event: ChatProjectionEvent): boolean {
    const recorderEnabled = this.perfRecorder.enabled;
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    const accepted = this.eventGate.accept(event);
    const validatedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    try {
      if (!accepted) return false;
      switch (event.type) {
        case 'messages.replace':
          this.replaceAll(event.messages, event.type);
          break;
        case 'message.upsert':
          if (event.delivery === 'immediate') this.upsertNow(event.message, event.type);
          else this.queueUpsert(event.message, event.type);
          break;
        case 'text.append':
        case 'tool.upsert':
        case 'agent.upsert':
          this.queueUpsert(event.message, event.type);
          break;
        case 'messages.truncate':
          this.truncate(event.messageIds);
          break;
        case 'messages.reveal-previous-page':
          return this.prependPreviousPage();
        case 'messages.prepend-page':
          return this.prependPage(event.messages);
        case 'projection.flush':
          this.flush();
          break;
        case 'run.terminal':
          this.flush();
          this.eventGate.markRunTerminal(event);
          break;
      }
      return true;
    } finally {
      if (recorderEnabled) {
        this.perfRecorder.onProjectionDispatch(
          event.type,
          accepted,
          Math.max(0, validatedAt - startedAt),
          Math.max(0, this.perfRecorder.now(this.ownerWindow) - startedAt),
          this.ownerWindow,
        );
      }
    }
  }

  replaceAll(
    messages: readonly ChatMessage[],
    eventType: ChatPerfProjectionEventType = 'messages.replace',
  ): void {
    const recorderEnabled = this.perfRecorder.enabled;
    if (recorderEnabled) {
      this.perfRecorder.onProjectionEvent('messages.replace', null, this.ownerWindow);
    }
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    this.cancelScheduledPublication();
    this.pendingMessages.clear();
    this.sourceMessages = messages;
    this.projectedStart = Math.max(0, messages.length - CHAT_PROJECTION_PAGE_SIZE);
    const projected = messages.slice(this.projectedStart);
    const nextIds = new Set(projected.map(message => message.id));
    const changedIds = new Set<string>();

    for (const id of this.messages.keys()) {
      if (!nextIds.has(id)) {
        this.messages.delete(id);
        this.clearMessageStructure(id);
        this.clearMessageEntities(id);
        changedIds.add(id);
      }
    }
    for (const message of projected) {
      const snapshot = snapshotMessage(
        message,
        this.perfRecorder,
        eventType,
        this.ownerWindow,
      );
      const entityStartedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
      this.messages.set(message.id, snapshot);
      this.reconcileMessageStructure(snapshot);
      this.indexMessageEntities(snapshot);
      changedIds.add(message.id);
      if (recorderEnabled) {
        this.recordEntityCommit(message.id, entityStartedAt);
      }
    }
    this.order = Object.freeze(projected.map(message => message.id));
    this.notifyOrder();
    for (const id of changedIds) this.notifyMessage(id);
    if (recorderEnabled) {
      this.recordCommit('replace', this.order, startedAt);
    }
  }

  /** Make one older in-memory page visible without re-reading JSONL. */
  private prependPreviousPage(): boolean {
    if (this.projectedStart <= 0) return false;
    const nextStart = Math.max(0, this.projectedStart - CHAT_PROJECTION_PAGE_SIZE);
    const prepended = this.sourceMessages.slice(nextStart, this.projectedStart);
    this.projectedStart = nextStart;
    for (const message of prepended) {
      const snapshot = snapshotMessage(
        message,
        this.perfRecorder,
        'messages.reveal-previous-page',
        this.ownerWindow,
      );
      const entityStartedAt = this.perfRecorder.enabled
        ? this.perfRecorder.now(this.ownerWindow)
        : 0;
      this.messages.set(message.id, snapshot);
      this.reconcileMessageStructure(snapshot);
      this.indexMessageEntities(snapshot);
      this.notifyMessage(message.id);
      if (this.perfRecorder.enabled) {
        this.recordEntityCommit(message.id, entityStartedAt);
      }
    }
    this.order = Object.freeze([
      ...prepended.map(message => message.id),
      ...this.order,
    ]);
    this.notifyOrder();
    return true;
  }

  hasPreviousPage(): boolean {
    return this.projectedStart > 0;
  }

  /** Prepend a page fetched by the runtime without replacing the visible projection. */
  private prependPage(messages: readonly ChatMessage[]): boolean {
    if (this.projectedStart > 0) {
      throw new Error('Reveal loaded projection pages before prepending a fetched page');
    }
    const existingIds = new Set(this.sourceMessages.map(message => message.id));
    const prepended = messages.filter(message => !existingIds.has(message.id));
    if (prepended.length === 0) return false;
    this.sourceMessages = [...prepended, ...this.sourceMessages];
    for (const message of prepended) {
      const snapshot = snapshotMessage(
        message,
        this.perfRecorder,
        'messages.prepend-page',
        this.ownerWindow,
      );
      const entityStartedAt = this.perfRecorder.enabled
        ? this.perfRecorder.now(this.ownerWindow)
        : 0;
      this.messages.set(message.id, snapshot);
      this.reconcileMessageStructure(snapshot);
      this.indexMessageEntities(snapshot);
      this.notifyMessage(message.id);
      if (this.perfRecorder.enabled) {
        this.recordEntityCommit(message.id, entityStartedAt);
      }
    }
    this.order = Object.freeze([
      ...prepended.map(message => message.id),
      ...this.order,
    ]);
    this.notifyOrder();
    return true;
  }

  upsertNow(
    message: ChatMessage,
    eventType: ChatPerfProjectionEventType = 'message.upsert',
  ): void {
    const recorderEnabled = this.perfRecorder.enabled;
    if (recorderEnabled) {
      this.perfRecorder.onProjectionEvent('message.upsert', message.id, this.ownerWindow);
    }
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    this.commitSnapshot(snapshotMessage(
      message,
      this.perfRecorder,
      eventType,
      this.ownerWindow,
    ));
    if (recorderEnabled) this.recordCommit('immediate', [message.id], startedAt);
  }

  private commitSnapshot(snapshot: ProjectionMessage): void {
    const current = this.messages.get(snapshot.id);
    // Accepted events can republish an unchanged post-effect message (usage/done/notice).
    if (current && structurallyEqual(current, snapshot)) return;
    const recorderEnabled = this.perfRecorder.enabled;
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    const isNew = current === undefined;
    this.messages.set(snapshot.id, snapshot);
    this.reconcileMessageStructure(snapshot);
    this.indexMessageEntities(snapshot);
    this.notifyMessage(snapshot.id);
    if (isNew) {
      this.order = Object.freeze([...this.order, snapshot.id]);
      this.notifyOrder();
    }
    if (recorderEnabled) this.recordEntityCommit(snapshot.id, startedAt);
  }

  private queueUpsert(message: ChatMessage, eventType: ChatPerfProjectionEventType): void {
    if (this.perfRecorder.enabled) {
      this.perfRecorder.onProjectionEvent('message.upsert', message.id, this.ownerWindow);
    }
    this.pendingMessages.set(message.id, snapshotMessage(
      message,
      this.perfRecorder,
      eventType,
      this.ownerWindow,
    ));
    this.schedulePendingPublication();
  }

  flush(): void {
    this.cancelScheduledPublication();
    this.flushPendingMessages('explicit-flush');
  }

  truncate(messageIds: readonly string[]): void {
    const recorderEnabled = this.perfRecorder.enabled;
    if (recorderEnabled) {
      this.perfRecorder.onProjectionEvent('messages.truncate', null, this.ownerWindow);
    }
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    this.flush();
    const retained = new Set(messageIds);
    this.sourceMessages = this.sourceMessages.filter(message => retained.has(message.id));
    this.projectedStart = Math.min(this.projectedStart, this.sourceMessages.length);
    for (const id of this.messages.keys()) {
      if (!retained.has(id)) {
        this.messages.delete(id);
        this.clearMessageStructure(id);
        this.clearMessageEntities(id);
        this.notifyMessage(id);
      }
    }
    this.order = Object.freeze(messageIds.filter(id => this.messages.has(id)));
    this.notifyOrder();
    if (recorderEnabled) this.recordCommit('truncate', this.order, startedAt);
  }

  dispose(): void {
    this.cancelScheduledPublication();
    this.cancelPaintFrame();
    this.ownerWindow?.document?.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.pendingMessages.clear();
    this.orderListeners.clear();
    this.messageListeners.clear();
    this.messageStructureListeners.clear();
    this.blockListeners.clear();
    this.toolListeners.clear();
    this.messages.clear();
    this.messageStructures.clear();
    this.blocks.clear();
    this.tools.clear();
    this.entityKeysByMessageId.clear();
    this.eventGate.clear();
    this.sourceMessages = [];
  }

  private flushPendingMessages(reason: ChatPerfProjectionCommitReason): void {
    if (this.pendingMessages.size === 0) return;
    const recorderEnabled = this.perfRecorder.enabled;
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    const pending = [...this.pendingMessages.values()];
    this.pendingMessages.clear();
    for (const message of pending) this.commitSnapshot(message);
    if (recorderEnabled) {
      this.recordCommit(reason, pending.map(message => message.id), startedAt);
    }
  }

  private cancelFrame(): void {
    if (this.pendingFrame === null) return;
    this.ownerWindow?.cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
  }

  private cancelTimer(): void {
    if (this.pendingTimer === null) return;
    this.ownerWindow?.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private cancelScheduledPublication(): void {
    this.cancelFrame();
    this.cancelTimer();
  }

  private readonly handleVisibilityChange = (): void => {
    this.rescheduleForCadenceChange();
  };

  private rescheduleForCadenceChange(): void {
    if (this.pendingMessages.size === 0) return;
    this.cancelScheduledPublication();
    if (this.surfaceActive && this.ownerWindow?.document?.visibilityState !== 'hidden') {
      this.flushPendingMessages('visibility-resume');
      return;
    }
    this.schedulePendingPublication();
  }

  private schedulePendingPublication(): void {
    if (this.pendingMessages.size === 0 || this.pendingFrame !== null || this.pendingTimer !== null) return;
    const ownerWindow = this.ownerWindow;
    if (!ownerWindow) {
      this.flush();
      return;
    }
    if (this.surfaceActive && ownerWindow.document?.visibilityState !== 'hidden') {
      this.pendingFrame = ownerWindow.requestAnimationFrame(() => {
        this.pendingFrame = null;
        this.flushPendingMessages('animation-frame');
      });
      return;
    }
    this.pendingTimer = ownerWindow.setTimeout(() => {
      this.pendingTimer = null;
      this.flushPendingMessages('hidden-timer');
    }, CHAT_PROJECTION_HIDDEN_CADENCE_MS);
  }

  private cancelPaintFrame(): void {
    if (this.pendingPaintFrame === null) return;
    this.ownerWindow?.cancelAnimationFrame(this.pendingPaintFrame);
    this.pendingPaintFrame = null;
  }

  private recordCommit(
    reason: ChatPerfProjectionCommitReason,
    messageIds: readonly string[],
    startedAt: number,
  ): void {
    const ownerWindow = this.ownerWindow;
    const durationMs = Math.max(0, this.perfRecorder.now(ownerWindow) - startedAt);
    this.perfRecorder.onProjectionCommit(reason, messageIds, durationMs, ownerWindow);
    if (!ownerWindow) return;
    this.cancelPaintFrame();
    this.pendingPaintFrame = ownerWindow.requestAnimationFrame(() => {
      this.pendingPaintFrame = null;
      this.perfRecorder.onProjectionPaint(reason, messageIds, ownerWindow);
    });
  }

  private recordEntityCommit(messageId: string, startedAt: number): void {
    this.perfRecorder.onProjectionEntityCommit(
      messageId,
      Math.max(0, this.perfRecorder.now(this.ownerWindow) - startedAt),
      this.ownerWindow,
    );
  }

  private notifyOrder(): void {
    for (const listener of this.orderListeners) listener();
  }

  private notifyMessage(messageId: string): void {
    for (const listener of this.messageListeners.get(messageId) ?? []) listener();
  }

  private subscribeEntity(
    registry: Map<string, Set<ProjectionListener>>,
    entityId: string,
    listener: ProjectionListener,
  ): () => void {
    let listeners = registry.get(entityId);
    if (!listeners) {
      listeners = new Set();
      registry.set(entityId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) registry.delete(entityId);
    };
  }

  private clearMessageEntities(messageId: string, notify = true): void {
    const keys = this.entityKeysByMessageId.get(messageId);
    if (!keys) return;
    const remove = (
      ids: readonly string[],
      entities: Map<string, unknown>,
      listeners: Map<string, Set<ProjectionListener>>,
    ) => {
      for (const id of ids) {
        entities.delete(id);
        if (notify) for (const listener of listeners.get(id) ?? []) listener();
      }
    };
    remove(keys.blockIds, this.blocks, this.blockListeners);
    remove(keys.toolIds, this.tools, this.toolListeners);
    this.entityKeysByMessageId.delete(messageId);
  }

  private clearMessageStructure(messageId: string): void {
    if (!this.messageStructures.delete(messageId)) return;
    for (const listener of this.messageStructureListeners.get(messageId) ?? []) listener();
  }

  private reconcileMessageStructure(message: ProjectionMessage): void {
    const current = this.messageStructures.get(message.id);
    if (current && messageStructuresEqual(current, message)) return;
    this.messageStructures.set(message.id, message);
    for (const listener of this.messageStructureListeners.get(message.id) ?? []) listener();
  }

  private indexMessageEntities(message: ProjectionMessage): void {
    const previous = this.entityKeysByMessageId.get(message.id)
      ?? { blockIds: [], toolIds: [] };
    const keys: MessageEntityKeys = { blockIds: [], toolIds: [] };
    for (const [index, block] of (message.contentBlocks ?? []).entries()) {
      const id = getChatProjectionBlockId(message.id, index);
      keys.blockIds.push(id);
      const current = this.blocks.get(id);
      if (!current || !structurallyEqual(current.block, block)) {
        this.blocks.set(id, deepFreeze({ id, messageId: message.id, index, block }));
        for (const listener of this.blockListeners.get(id) ?? []) listener();
      }
    }
    for (const tool of message.toolCalls ?? []) {
      keys.toolIds.push(tool.id);
      const current = this.tools.get(tool.id);
      if (!current || !toolEntitiesEqual(current.tool as ToolCallInfo, tool as ToolCallInfo)) {
        this.tools.set(tool.id, deepFreeze({ id: tool.id, messageId: message.id, tool }));
        for (const listener of this.toolListeners.get(tool.id) ?? []) listener();
      }
    }
    const removeMissing = (
      previousIds: readonly string[],
      nextIds: readonly string[],
      entities: Map<string, unknown>,
      listeners: Map<string, Set<ProjectionListener>>,
    ) => {
      const retained = new Set(nextIds);
      for (const id of previousIds) {
        if (retained.has(id)) continue;
        entities.delete(id);
        for (const listener of listeners.get(id) ?? []) listener();
      }
    };
    removeMissing(previous.blockIds, keys.blockIds, this.blocks, this.blockListeners);
    removeMissing(previous.toolIds, keys.toolIds, this.tools, this.toolListeners);
    this.entityKeysByMessageId.set(message.id, keys);
  }
}
