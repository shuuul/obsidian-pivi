import type {
  ChatMessage,
  ContentBlock,
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import { useSyncExternalStore } from 'react';

import {
  type ChatPerfProjectionCommitReason,
  type ChatPerfRecorder,
  NOOP_CHAT_PERF_RECORDER,
} from './chatPerfRecorder';
import type { DeepReadonly } from './chatUiStore';

export const CHAT_PROJECTION_PAGE_SIZE = 100;

export type ChatUiEvent =
  | { readonly type: 'messages.replace'; readonly messages: readonly ChatMessage[] }
  | { readonly type: 'message.upsert'; readonly message: ChatMessage }
  | {
      readonly type: 'text.append';
      readonly messageId: string;
      readonly blockId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'tool.upsert';
      readonly messageId: string;
      readonly tool: ToolCallInfo;
    }
  | {
      readonly type: 'agent.patch';
      readonly messageId: string;
      readonly agentId: string;
      readonly patch: Partial<SubagentInfo>;
    }
  | { readonly type: 'messages.truncate'; readonly messageIds: readonly string[] }
  | { readonly type: 'terminal.flush' };

type ProjectionMessage = DeepReadonly<ChatMessage>;
type ProjectionListener = () => void;

export interface ChatBlockEntity {
  readonly id: string;
  readonly messageId: string;
  readonly index: number;
  readonly block: ContentBlock;
}

export interface ChatToolEntity {
  readonly id: string;
  readonly messageId: string;
  readonly tool: ToolCallInfo;
}

export interface ChatAgentRunEntity {
  readonly id: string;
  readonly messageId: string;
  readonly agent: SubagentInfo;
}

interface MessageEntityKeys {
  blockIds: string[];
  toolIds: string[];
  agentIds: string[];
}

function cloneSerializableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneSerializableValue);
  if (typeof value !== 'object') {
    throw new TypeError(`Chat projection snapshots cannot contain ${typeof value} values`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const constructorName = (prototype as { constructor?: { name?: string } } | null)?.constructor?.name;
  if (prototype !== null && prototype !== Object.prototype && constructorName !== 'Object') {
    throw new TypeError(`Chat projection snapshots can contain only plain objects and arrays, received ${constructorName ?? 'unknown object'}`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneSerializableValue(child)]),
  );
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value as DeepReadonly<T>;
}

function snapshotMessage(message: ChatMessage): ProjectionMessage {
  return deepFreeze(cloneSerializableValue(message) as ChatMessage);
}

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
  private readonly blocks = new Map<string, DeepReadonly<ChatBlockEntity>>();
  private readonly tools = new Map<string, DeepReadonly<ChatToolEntity>>();
  private readonly agentRuns = new Map<string, DeepReadonly<ChatAgentRunEntity>>();
  private readonly entityKeysByMessageId = new Map<string, MessageEntityKeys>();
  private sourceMessages: readonly ChatMessage[] = [];
  private projectedStart = 0;
  private ownerWindow: Window | null = null;
  private pendingFrame: number | null = null;
  private pendingPaintFrame: number | null = null;
  private readonly pendingMessages = new Map<string, ChatMessage>();
  private readonly orderListeners = new Set<ProjectionListener>();
  private readonly messageListeners = new Map<string, Set<ProjectionListener>>();
  private readonly blockListeners = new Map<string, Set<ProjectionListener>>();
  private readonly toolListeners = new Map<string, Set<ProjectionListener>>();
  private readonly agentRunListeners = new Map<string, Set<ProjectionListener>>();

  constructor(readonly perfRecorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER) {}

  readonly getOrderSnapshot = (): readonly string[] => this.order;

  getMessageSnapshot = (messageId: string): ProjectionMessage | null => (
    this.messages.get(messageId) ?? null
  );

  getBlockSnapshot = (blockId: string): DeepReadonly<ChatBlockEntity> | null => (
    this.blocks.get(blockId) ?? null
  );

  getToolSnapshot = (toolId: string): DeepReadonly<ChatToolEntity> | null => (
    this.tools.get(toolId) ?? null
  );

  getAgentRunSnapshot = (agentId: string): DeepReadonly<ChatAgentRunEntity> | null => (
    this.agentRuns.get(agentId) ?? null
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

  subscribeBlock = (blockId: string, listener: ProjectionListener): (() => void) => (
    this.subscribeEntity(this.blockListeners, blockId, listener)
  );

  subscribeTool = (toolId: string, listener: ProjectionListener): (() => void) => (
    this.subscribeEntity(this.toolListeners, toolId, listener)
  );

  subscribeAgentRun = (agentId: string, listener: ProjectionListener): (() => void) => (
    this.subscribeEntity(this.agentRunListeners, agentId, listener)
  );

  setOwnerWindow(ownerWindow: Window | null): void {
    if (ownerWindow !== this.ownerWindow) this.cancelPaintFrame();
    this.ownerWindow = ownerWindow;
  }

  dispatch(event: ChatUiEvent): void {
    switch (event.type) {
      case 'messages.replace':
        this.replaceAll(event.messages);
        break;
      case 'message.upsert':
        this.queueUpsert(event.message);
        break;
      case 'text.append':
        this.queueTextAppend(event.messageId, event.blockId, event.delta);
        break;
      case 'tool.upsert':
        this.queueToolUpsert(event.messageId, event.tool);
        break;
      case 'agent.patch':
        this.queueAgentPatch(event.messageId, event.agentId, event.patch);
        break;
      case 'messages.truncate':
        this.truncate(event.messageIds);
        break;
      case 'terminal.flush':
        this.flush();
        break;
    }
  }

  replaceAll(messages: readonly ChatMessage[]): void {
    const recorderEnabled = this.perfRecorder.enabled;
    if (recorderEnabled) {
      this.perfRecorder.onProjectionEvent('messages.replace', null, this.ownerWindow);
    }
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    this.cancelFrame();
    this.pendingMessages.clear();
    this.sourceMessages = messages;
    this.projectedStart = Math.max(0, messages.length - CHAT_PROJECTION_PAGE_SIZE);
    const projected = messages.slice(this.projectedStart);
    const nextIds = new Set(projected.map(message => message.id));
    const changedIds = new Set<string>();

    for (const id of this.messages.keys()) {
      if (!nextIds.has(id)) {
        this.messages.delete(id);
        this.clearMessageEntities(id);
        changedIds.add(id);
      }
    }
    for (const message of projected) {
      const snapshot = snapshotMessage(message);
      this.messages.set(message.id, snapshot);
      this.indexMessageEntities(snapshot);
      changedIds.add(message.id);
    }
    this.order = Object.freeze(projected.map(message => message.id));
    this.notifyOrder();
    for (const id of changedIds) this.notifyMessage(id);
    if (recorderEnabled) {
      this.recordCommit('replace', this.order, startedAt);
    }
  }

  /** Make one older in-memory page visible without re-reading JSONL. */
  prependPreviousPage(): boolean {
    if (this.projectedStart <= 0) return false;
    const nextStart = Math.max(0, this.projectedStart - CHAT_PROJECTION_PAGE_SIZE);
    const prepended = this.sourceMessages.slice(nextStart, this.projectedStart);
    this.projectedStart = nextStart;
    for (const message of prepended) {
      const snapshot = snapshotMessage(message);
      this.messages.set(message.id, snapshot);
      this.indexMessageEntities(snapshot);
      this.notifyMessage(message.id);
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
  prependPage(messages: readonly ChatMessage[]): boolean {
    if (this.projectedStart > 0) {
      throw new Error('Reveal loaded projection pages before prepending a fetched page');
    }
    const existingIds = new Set(this.sourceMessages.map(message => message.id));
    const prepended = messages.filter(message => !existingIds.has(message.id));
    if (prepended.length === 0) return false;
    this.sourceMessages = [...prepended, ...this.sourceMessages];
    for (const message of prepended) {
      const snapshot = snapshotMessage(message);
      this.messages.set(message.id, snapshot);
      this.indexMessageEntities(snapshot);
      this.notifyMessage(message.id);
    }
    this.order = Object.freeze([
      ...prepended.map(message => message.id),
      ...this.order,
    ]);
    this.notifyOrder();
    return true;
  }

  upsertNow(message: ChatMessage): void {
    const recorderEnabled = this.perfRecorder.enabled;
    if (recorderEnabled) {
      this.perfRecorder.onProjectionEvent('message.upsert', message.id, this.ownerWindow);
    }
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    this.commitMessage(message);
    if (recorderEnabled) this.recordCommit('immediate', [message.id], startedAt);
  }

  private commitMessage(message: ChatMessage): void {
    const isNew = !this.messages.has(message.id);
    const snapshot = snapshotMessage(message);
    this.messages.set(message.id, snapshot);
    this.indexMessageEntities(snapshot);
    this.notifyMessage(message.id);
    if (isNew) {
      this.order = Object.freeze([...this.order, message.id]);
      this.notifyOrder();
    }
  }

  queueUpsert(message: ChatMessage): void {
    if (this.perfRecorder.enabled) {
      this.perfRecorder.onProjectionEvent('message.upsert', message.id, this.ownerWindow);
    }
    this.pendingMessages.set(message.id, message);
    if (this.pendingFrame !== null) return;
    const ownerWindow = this.ownerWindow;
    if (!ownerWindow) {
      this.flush();
      return;
    }
    this.pendingFrame = ownerWindow.requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.flushPendingMessages('animation-frame');
    });
  }

  private mutablePendingMessage(messageId: string): ChatMessage | null {
    const current = this.pendingMessages.get(messageId) ?? this.messages.get(messageId);
    return current ? cloneSerializableValue(current) as ChatMessage : null;
  }

  private queueTextAppend(messageId: string, blockId: string, delta: string): void {
    const message = this.mutablePendingMessage(messageId);
    const block = this.blocks.get(blockId);
    if (!message || !block) return;
    const target = message.contentBlocks?.[block.index];
    if (!target || (target.type !== 'text' && target.type !== 'thinking')) {
      throw new Error(`Text append target ${blockId} is not a text-bearing block`);
    }
    target.content += delta;
    if (target.type === 'text') message.content += delta;
    this.queueUpsert(message);
  }

  private queueToolUpsert(messageId: string, tool: ToolCallInfo): void {
    const message = this.mutablePendingMessage(messageId);
    if (!message) return;
    const tools = [...(message.toolCalls ?? [])];
    const index = tools.findIndex(candidate => candidate.id === tool.id);
    if (index >= 0) tools[index] = tool;
    else tools.push(tool);
    message.toolCalls = tools;
    this.queueUpsert(message);
  }

  private queueAgentPatch(
    messageId: string,
    agentId: string,
    patch: Partial<SubagentInfo>,
  ): void {
    const message = this.mutablePendingMessage(messageId);
    if (!message) return;
    const tool = message.toolCalls?.find(candidate => (
      candidate.subagent?.id === agentId || candidate.subagent?.agentId === agentId
    ));
    if (!tool?.subagent) return;
    tool.subagent = { ...tool.subagent, ...patch };
    this.queueUpsert(message);
  }

  flush(): void {
    this.cancelFrame();
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
    for (const id of this.messages.keys()) {
      if (!retained.has(id)) {
        this.messages.delete(id);
        this.clearMessageEntities(id);
        this.notifyMessage(id);
      }
    }
    this.order = Object.freeze(messageIds.filter(id => this.messages.has(id)));
    this.notifyOrder();
    if (recorderEnabled) this.recordCommit('truncate', this.order, startedAt);
  }

  dispose(): void {
    this.cancelFrame();
    this.cancelPaintFrame();
    this.pendingMessages.clear();
    this.orderListeners.clear();
    this.messageListeners.clear();
    this.blockListeners.clear();
    this.toolListeners.clear();
    this.agentRunListeners.clear();
    this.messages.clear();
    this.blocks.clear();
    this.tools.clear();
    this.agentRuns.clear();
    this.entityKeysByMessageId.clear();
    this.sourceMessages = [];
  }

  private flushPendingMessages(reason: 'animation-frame' | 'explicit-flush'): void {
    if (this.pendingMessages.size === 0) return;
    const recorderEnabled = this.perfRecorder.enabled;
    const startedAt = recorderEnabled ? this.perfRecorder.now(this.ownerWindow) : 0;
    const pending = [...this.pendingMessages.values()];
    this.pendingMessages.clear();
    for (const message of pending) this.commitMessage(message);
    if (recorderEnabled) {
      this.recordCommit(reason, pending.map(message => message.id), startedAt);
    }
  }

  private cancelFrame(): void {
    if (this.pendingFrame === null) return;
    this.ownerWindow?.cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
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
    remove(keys.agentIds, this.agentRuns, this.agentRunListeners);
    this.entityKeysByMessageId.delete(messageId);
  }

  private indexMessageEntities(message: ProjectionMessage): void {
    this.clearMessageEntities(message.id, false);
    const keys: MessageEntityKeys = { blockIds: [], toolIds: [], agentIds: [] };
    for (const [index, block] of (message.contentBlocks ?? []).entries()) {
      const id = `${message.id}:block:${index}`;
      this.blocks.set(id, deepFreeze({ id, messageId: message.id, index, block }));
      keys.blockIds.push(id);
      for (const listener of this.blockListeners.get(id) ?? []) listener();
    }
    for (const tool of message.toolCalls ?? []) {
      this.tools.set(tool.id, deepFreeze({ id: tool.id, messageId: message.id, tool }));
      keys.toolIds.push(tool.id);
      for (const listener of this.toolListeners.get(tool.id) ?? []) listener();
      if (tool.subagent) {
        const id = tool.subagent.agentId ?? tool.subagent.id;
        this.agentRuns.set(id, deepFreeze({ id, messageId: message.id, agent: tool.subagent }));
        keys.agentIds.push(id);
        for (const listener of this.agentRunListeners.get(id) ?? []) listener();
      }
    }
    this.entityKeysByMessageId.set(message.id, keys);
  }
}

export function useChatProjectionOrder(store: ChatProjectionStore): readonly string[] {
  return useSyncExternalStore(store.subscribeOrder, store.getOrderSnapshot, store.getOrderSnapshot);
}

export function useChatProjectionMessage(
  store: ChatProjectionStore,
  messageId: string,
): ProjectionMessage | null {
  return useSyncExternalStore(
    listener => store.subscribeMessage(messageId, listener),
    () => store.getMessageSnapshot(messageId),
    () => store.getMessageSnapshot(messageId),
  );
}

export function useChatProjectionBlock(store: ChatProjectionStore, blockId: string) {
  return useSyncExternalStore(
    listener => store.subscribeBlock(blockId, listener),
    () => store.getBlockSnapshot(blockId),
    () => store.getBlockSnapshot(blockId),
  );
}

export function useChatProjectionTool(store: ChatProjectionStore, toolId: string) {
  return useSyncExternalStore(
    listener => store.subscribeTool(toolId, listener),
    () => store.getToolSnapshot(toolId),
    () => store.getToolSnapshot(toolId),
  );
}

export function useChatProjectionAgentRun(store: ChatProjectionStore, agentId: string) {
  return useSyncExternalStore(
    listener => store.subscribeAgentRun(agentId, listener),
    () => store.getAgentRunSnapshot(agentId),
    () => store.getAgentRunSnapshot(agentId),
  );
}
