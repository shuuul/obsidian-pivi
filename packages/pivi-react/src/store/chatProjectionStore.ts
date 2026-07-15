import type {
  ChatMessage,
  ContentBlock,
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import {
  isToolPresentationGroupable,
  shouldPresentToolCall,
} from '@pivi/pivi-agent-core/tools/toolPresentation';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import {
  type ChatPerfProjectionCommitReason,
  type ChatPerfRecorder,
  NOOP_CHAT_PERF_RECORDER,
} from './chatPerfRecorder';
import type { DeepReadonly } from './chatUiStore';

export const CHAT_PROJECTION_PAGE_SIZE = 100;

export interface ChatProjectionEventMetadata {
  readonly projectionScopeId: string;
  readonly sessionFile: string | null;
  readonly openSessionId: string | null;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly sequence: number;
  readonly timestamp: number;
}

interface ChatProjectionEventIds {
  readonly messageId: string | null;
  readonly blockId: string | null;
  readonly toolId: string | null;
  readonly agentId: string | null;
}

type ChatProjectionEventBase = ChatProjectionEventMetadata & ChatProjectionEventIds;

export type ChatProjectionMessageChange =
  | { readonly type: 'message.upsert' }
  | { readonly type: 'text.append'; readonly blockId: string; readonly delta: string }
  | { readonly type: 'tool.upsert'; readonly tool: ToolCallInfo }
  | { readonly type: 'agent.upsert'; readonly agent: SubagentInfo };

export type ChatProjectionEvent =
  | ChatProjectionEventBase & {
      readonly type: 'messages.replace';
      readonly messages: readonly ChatMessage[];
    }
  | ChatProjectionEventBase & {
      readonly type: 'message.upsert';
      readonly messageId: string;
      readonly message: ChatMessage;
      readonly delivery: 'immediate' | 'queued';
    }
  | ChatProjectionEventBase & {
      readonly type: 'text.append';
      readonly messageId: string;
      readonly blockId: string;
      readonly message: ChatMessage;
      readonly delta: string;
    }
  | ChatProjectionEventBase & {
      readonly type: 'tool.upsert';
      readonly messageId: string;
      readonly toolId: string;
      readonly message: ChatMessage;
      readonly tool: ToolCallInfo;
    }
  | ChatProjectionEventBase & {
      readonly type: 'agent.upsert';
      readonly messageId: string;
      readonly agentId: string;
      readonly message: ChatMessage;
      readonly agent: SubagentInfo;
    }
  | ChatProjectionEventBase & {
      readonly type: 'messages.truncate';
      readonly messageIds: readonly string[];
    }
  | ChatProjectionEventBase & { readonly type: 'projection.flush' }
  | ChatProjectionEventBase & { readonly type: 'run.terminal' };

export type ChatProjectionDiagnosticCode =
  | 'duplicate-sequence'
  | 'late-after-terminal'
  | 'missing-owner'
  | 'out-of-order-sequence';

export interface ChatProjectionDiagnostic {
  readonly code: ChatProjectionDiagnosticCode;
  readonly eventType: ChatProjectionEvent['type'];
  readonly projectionScopeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly messageId: string | null;
  readonly blockId: string | null;
  readonly toolId: string | null;
  readonly agentId: string | null;
}

export type ChatProjectionDiagnosticListener = (diagnostic: ChatProjectionDiagnostic) => void;

const NOOP_PROJECTION_DIAGNOSTIC_LISTENER: ChatProjectionDiagnosticListener = () => {};

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

export function getChatProjectionBlockId(messageId: string, index: number): string {
  return `${messageId}:block:${index}`;
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

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => structurallyEqual(value, right[index]));
  }
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  if (leftEntries.length !== Object.keys(rightRecord).length) return false;
  return leftEntries.every(([key, value]) => (
    Object.hasOwn(rightRecord, key) && structurallyEqual(value, rightRecord[key])
  ));
}

function toolEntitiesEqual(left: ToolCallInfo, right: ToolCallInfo): boolean {
  const { subagent: leftSubagent, ...leftTool } = left;
  const { subagent: rightSubagent, ...rightTool } = right;
  return structurallyEqual(leftTool, rightTool)
    && leftSubagent?.id === rightSubagent?.id
    && leftSubagent?.agentId === rightSubagent?.agentId;
}

function messageStructuresEqual(left: ProjectionMessage, right: ProjectionMessage): boolean {
  if (left.role !== right.role) return false;
  if (left.role === 'user' || right.role === 'user') return structurallyEqual(left, right);
  const structure = (message: ProjectionMessage) => ({
    content: message.contentBlocks?.length ? Boolean(message.content.trim()) : message.content,
    contentBlocks: (message.contentBlocks ?? []).map(block => {
      switch (block.type) {
        case 'text':
        case 'thinking':
          return { type: block.type, visible: Boolean(block.content.trim()) };
        case 'tool_use':
          return { type: block.type, toolId: block.toolId };
        case 'subagent':
          return { type: block.type, subagentId: block.subagentId, mode: block.mode };
        case 'context_compacted':
          return { type: block.type };
      }
    }),
    durationFlavorWord: message.durationFlavorWord,
    durationSeconds: message.durationSeconds,
    id: message.id,
    isInterrupt: message.isInterrupt,
    isRebuiltContext: message.isRebuiltContext,
    toolCalls: (message.toolCalls ?? []).map(tool => ({
      groupable: isToolPresentationGroupable(tool.name, tool.input, Boolean(tool.subagent)),
      id: tool.id,
      subagentId: tool.subagent?.id,
      subagentAgentId: tool.subagent?.agentId,
      visible: shouldPresentToolCall(tool.name, tool.input),
    })),
  });
  return structurallyEqual(structure(left), structure(right));
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
  private readonly messageStructures = new Map<string, ProjectionMessage>();
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
  private readonly activeOwnerByScope = new Map<string, string>();
  private readonly lastSequenceByOwner = new Map<string, number>();
  private readonly terminalRuns = new Set<string>();
  private readonly orderListeners = new Set<ProjectionListener>();
  private readonly messageListeners = new Map<string, Set<ProjectionListener>>();
  private readonly messageStructureListeners = new Map<string, Set<ProjectionListener>>();
  private readonly blockListeners = new Map<string, Set<ProjectionListener>>();
  private readonly toolListeners = new Map<string, Set<ProjectionListener>>();
  private readonly agentRunListeners = new Map<string, Set<ProjectionListener>>();

  constructor(
    readonly perfRecorder: ChatPerfRecorder = NOOP_CHAT_PERF_RECORDER,
    private readonly onDiagnostic: ChatProjectionDiagnosticListener = NOOP_PROJECTION_DIAGNOSTIC_LISTENER,
  ) {}

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

  subscribeMessageStructure(messageId: string, listener: ProjectionListener): () => void {
    return this.subscribeEntity(this.messageStructureListeners, messageId, listener);
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

  /** The sole production ingestion boundary for message projection changes. */
  dispatch(event: ChatProjectionEvent): void {
    if (!this.acceptEvent(event)) return;
    switch (event.type) {
      case 'messages.replace':
        this.replaceAll(event.messages);
        break;
      case 'message.upsert':
        if (event.delivery === 'immediate') this.upsertNow(event.message);
        else this.queueUpsert(event.message);
        break;
      case 'text.append':
      case 'tool.upsert':
      case 'agent.upsert':
        this.queueUpsert(event.message);
        break;
      case 'messages.truncate':
        this.truncate(event.messageIds);
        break;
      case 'projection.flush':
        this.flush();
        break;
      case 'run.terminal':
        this.flush();
        this.terminalRuns.add(this.runKey(this.ownerKey(event), event.runId));
        break;
    }
  }

  private acceptEvent(event: ChatProjectionEvent): boolean {
    const ownerKey = this.ownerKey(event);
    const activeOwner = this.activeOwnerByScope.get(event.projectionScopeId);
    if (activeOwner !== ownerKey) {
      if (event.sequence !== 1) {
        this.reportDiagnostic('missing-owner', event);
        return false;
      }
      if (activeOwner) this.clearOwnerState(activeOwner);
      this.activeOwnerByScope.set(event.projectionScopeId, ownerKey);
    }

    const lastSequence = this.lastSequenceByOwner.get(ownerKey) ?? 0;
    if (event.sequence === lastSequence) {
      this.reportDiagnostic('duplicate-sequence', event);
      return false;
    }
    if (event.sequence !== lastSequence + 1) {
      this.reportDiagnostic('out-of-order-sequence', event);
      return false;
    }
    this.lastSequenceByOwner.set(ownerKey, event.sequence);

    if (this.isMessageMutation(event)
      && this.terminalRuns.has(this.runKey(ownerKey, event.runId))) {
      this.reportDiagnostic('late-after-terminal', event);
      return false;
    }
    if (!this.hasEventOwner(event)) {
      this.reportDiagnostic('missing-owner', event);
      return false;
    }
    return true;
  }

  private isMessageMutation(event: ChatProjectionEvent): boolean {
    return event.type === 'message.upsert'
      || event.type === 'text.append'
      || event.type === 'tool.upsert'
      || event.type === 'agent.upsert';
  }

  private hasEventOwner(event: ChatProjectionEvent): boolean {
    if (event.type === 'text.append') {
      if (!this.hasMessageOwner(event.messageId)) return false;
      const prefix = `${event.messageId}:block:`;
      const index = event.blockId.startsWith(prefix)
        ? Number(event.blockId.slice(prefix.length))
        : Number.NaN;
      const block = event.message.contentBlocks?.[index];
      return Number.isInteger(index) && (block?.type === 'text' || block?.type === 'thinking');
    }
    if (event.type === 'tool.upsert') {
      return this.hasMessageOwner(event.messageId)
        && event.message.toolCalls?.some(tool => tool.id === event.toolId) === true;
    }
    if (event.type === 'agent.upsert') {
      return this.hasMessageOwner(event.messageId)
        && event.message.toolCalls?.some(tool => (
          tool.subagent?.id === event.agentId || tool.subagent?.agentId === event.agentId
        )) === true;
    }
    return true;
  }

  private hasMessageOwner(messageId: string): boolean {
    return this.pendingMessages.has(messageId) || this.messages.has(messageId);
  }

  private ownerKey(event: ChatProjectionEvent): string {
    return `${event.projectionScopeId}\u0000${event.sessionFile ?? ''}\u0000${event.openSessionId ?? ''}`;
  }

  private runKey(ownerKey: string, runId: string): string {
    return `${ownerKey}\u0000${runId}`;
  }

  private clearOwnerState(ownerKey: string): void {
    this.lastSequenceByOwner.delete(ownerKey);
    const prefix = `${ownerKey}\u0000`;
    for (const runKey of this.terminalRuns) {
      if (runKey.startsWith(prefix)) this.terminalRuns.delete(runKey);
    }
  }

  private reportDiagnostic(
    code: ChatProjectionDiagnosticCode,
    event: ChatProjectionEvent,
  ): void {
    this.onDiagnostic({
      code,
      eventType: event.type,
      projectionScopeId: event.projectionScopeId,
      runId: event.runId,
      sequence: event.sequence,
      messageId: event.messageId,
      blockId: event.blockId,
      toolId: event.toolId,
      agentId: event.agentId,
    });
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
        this.clearMessageStructure(id);
        this.clearMessageEntities(id);
        changedIds.add(id);
      }
    }
    for (const message of projected) {
      const snapshot = snapshotMessage(message);
      this.messages.set(message.id, snapshot);
      this.reconcileMessageStructure(snapshot);
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
      this.reconcileMessageStructure(snapshot);
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
      this.reconcileMessageStructure(snapshot);
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
    this.reconcileMessageStructure(snapshot);
    this.indexMessageEntities(snapshot);
    this.notifyMessage(message.id);
    if (isNew) {
      this.order = Object.freeze([...this.order, message.id]);
      this.notifyOrder();
    }
  }

  private queueUpsert(message: ChatMessage): void {
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
    this.cancelFrame();
    this.cancelPaintFrame();
    this.pendingMessages.clear();
    this.orderListeners.clear();
    this.messageListeners.clear();
    this.messageStructureListeners.clear();
    this.blockListeners.clear();
    this.toolListeners.clear();
    this.agentRunListeners.clear();
    this.messages.clear();
    this.messageStructures.clear();
    this.blocks.clear();
    this.tools.clear();
    this.agentRuns.clear();
    this.entityKeysByMessageId.clear();
    this.activeOwnerByScope.clear();
    this.lastSequenceByOwner.clear();
    this.terminalRuns.clear();
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
      ?? { blockIds: [], toolIds: [], agentIds: [] };
    const keys: MessageEntityKeys = { blockIds: [], toolIds: [], agentIds: [] };
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
      if (tool.subagent) {
        const id = tool.subagent.agentId ?? tool.subagent.id;
        keys.agentIds.push(id);
        const currentAgent = this.agentRuns.get(id);
        if (!currentAgent || !structurallyEqual(currentAgent.agent, tool.subagent)) {
          this.agentRuns.set(id, deepFreeze({ id, messageId: message.id, agent: tool.subagent }));
          for (const listener of this.agentRunListeners.get(id) ?? []) listener();
        }
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
    removeMissing(previous.agentIds, keys.agentIds, this.agentRuns, this.agentRunListeners);
    this.entityKeysByMessageId.set(message.id, keys);
  }
}

export function useChatProjectionOrder(store: ChatProjectionStore): readonly string[] {
  return useSyncExternalStore(store.subscribeOrder, store.getOrderSnapshot, store.getOrderSnapshot);
}

export function useChatProjectionMessageStructure(
  store: ChatProjectionStore,
  messageId: string,
): ProjectionMessage | null {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeMessageStructure(messageId, listener),
    [messageId, store],
  );
  const getSnapshot = useCallback(
    () => store.getMessageStructureSnapshot(messageId),
    [messageId, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useChatProjectionBlock(store: ChatProjectionStore, blockId: string) {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeBlock(blockId, listener),
    [blockId, store],
  );
  const getSnapshot = useCallback(
    () => store.getBlockSnapshot(blockId),
    [blockId, store],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useChatProjectionTool(store: ChatProjectionStore, toolId: string) {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeTool(toolId, listener),
    [store, toolId],
  );
  const getSnapshot = useCallback(
    () => store.getToolSnapshot(toolId),
    [store, toolId],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useChatProjectionTools(
  store: ChatProjectionStore,
  toolIds: readonly string[],
) {
  const toolIdsKey = JSON.stringify(toolIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialized key intentionally stabilizes equal ID lists from rebuilt message snapshots
  const stableToolIds = useMemo(() => [...toolIds], [toolIdsKey]);
  const snapshotRef = useRef<readonly ReturnType<ChatProjectionStore['getToolSnapshot']>[]>([]);
  const subscribe = useCallback((listener: ProjectionListener) => {
    const unsubscribers = stableToolIds.map(toolId => store.subscribeTool(toolId, listener));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [stableToolIds, store]);
  const getSnapshot = useCallback(() => {
    const next = stableToolIds.map(toolId => store.getToolSnapshot(toolId));
    const previous = snapshotRef.current;
    if (
      previous.length === next.length
      && previous.every((entity, index) => entity === next[index])
    ) {
      return previous;
    }
    const snapshot = Object.freeze(next);
    snapshotRef.current = snapshot;
    return snapshot;
  }, [stableToolIds, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useChatProjectionAgentRun(store: ChatProjectionStore, agentId: string) {
  const subscribe = useCallback(
    (listener: ProjectionListener) => store.subscribeAgentRun(agentId, listener),
    [agentId, store],
  );
  const getSnapshot = useCallback(
    () => store.getAgentRunSnapshot(agentId),
    [agentId, store],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}
