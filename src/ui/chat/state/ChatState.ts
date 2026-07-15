import type { StreamChunk, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { SessionMessagePage } from '@pivi/pivi-agent-core/session';
import { deriveTodoVisualizationModel } from '@pivi/pivi-agent-core/tools';
import {
  type ChatPerfRecorder,
  type ChatProjectionEventMetadata,
  type ChatProjectionMessageChange,
  ChatProjectionStore,
  type ChatUiSnapshot,
  type ChatUiSnapshotKey,
  ChatUiStore,
  createChatStreamSnapshot,
  createInitialChatUiSnapshot,
  reduceChatStreamSnapshot,
} from '@pivi/pivi-react/store';

import type {
  ChatMessage,
  ChatStateCallbacks,
  ChatStateData,
  QueuedMessage,
  TodoItem,
  TodoVisualizationModel,
} from './types';

const logger = new PluginLogger('ChatProjectionProtocol');

export interface ChatProjectionProducerOptions {
  readonly projectionScopeId: string;
  readonly getSessionFile?: () => string | null;
  readonly now?: () => number;
}

export interface ChatProjectionRunScope {
  readonly childRunId?: string | null;
}

function createInitialState(): ChatStateData {
  return {
    messages: [],
    hasOlderMessages: false,
    totalMessageCount: 0,
    olderMessageCount: 0,
    olderUserMessageCount: 0,
    isStreaming: false,
    cancelRequested: false,
    streamGeneration: 0,
    isCreatingSession: false,
    isSwitchingSession: false,
    hasPendingSessionSave: false,
    currentOpenSessionId: null,
    queuedMessage: null,
    currentTextContent: '',
    usage: null,
    ignoreUsageUpdates: false,
    currentTodos: null,
    currentTodoVisualizationModel: null,
    needsAttention: false,
    autoScrollEnabled: true, // Default; controllers will override based on settings
    responseStartTime: null,
    welcomeGreeting: null,
    navigationVisible: false,
  };
}


export class ChatState {
  private state: ChatStateData;
  private readonly messagesById = new Map<string, ChatMessage>();
  private readonly ownerMessageBySubagentId = new Map<string, string>();
  private readonly ownerMessageByAgentId = new Map<string, string>();
  private readonly ownerMessageByToolId = new Map<string, string>();
  private readonly ownerKeysByMessageId = new Map<string, {
    subagentIds: Set<string>;
    agentIds: Set<string>;
    toolIds: Set<string>;
  }>();
  private _callbacks: ChatStateCallbacks;
  private currentThinkingContent = '';
  private projectionOwnerKey = '';
  private projectionSequence = 0;
  private readonly projectionScopeId: string;
  private readonly getProjectionSessionFile: () => string | null;
  private readonly projectionNow: () => number;
  readonly uiStore: ChatUiStore;
  readonly projectionStore: ChatProjectionStore;

  constructor(
    callbacks: ChatStateCallbacks = {},
    perfRecorder?: ChatPerfRecorder,
    projectionOptions: ChatProjectionProducerOptions = { projectionScopeId: 'unbound-chat' },
  ) {
    this.state = createInitialState();
    this._callbacks = callbacks;
    this.projectionScopeId = projectionOptions.projectionScopeId;
    this.getProjectionSessionFile = projectionOptions.getSessionFile ?? (() => null);
    this.projectionNow = projectionOptions.now ?? Date.now;
    this.uiStore = new ChatUiStore(createInitialChatUiSnapshot());
    this.projectionStore = new ChatProjectionStore(perfRecorder, diagnostic => {
      logger.warn(
        `Dropped projection event (${diagnostic.code}): scope=${diagnostic.projectionScopeId} run=${diagnostic.runId} type=${diagnostic.eventType} sequence=${diagnostic.sequence} message=${diagnostic.messageId ?? 'none'} block=${diagnostic.blockId ?? 'none'} tool=${diagnostic.toolId ?? 'none'} agent=${diagnostic.agentId ?? 'none'}`,
      );
    });
    this.uiStore.subscribe((changedKeys) => {
      this.notifyCallbacks(this.uiStore.getSnapshot(), changedKeys);
    });
  }

  private notifyCallbacks(
    snapshot: ChatUiSnapshot,
    changedKeys: ReadonlySet<ChatUiSnapshotKey>,
  ): void {
    if (changedKeys.has('isStreaming')) {
      this._callbacks.onStreamingStateChanged?.(snapshot.isStreaming);
    }
    if (changedKeys.has('currentOpenSessionId')) {
      this._callbacks.onOpenSessionChanged?.(snapshot.currentOpenSessionId);
    }
    if (changedKeys.has('needsAttention')) {
      this._callbacks.onAttentionChanged?.(snapshot.needsAttention);
    }
  }

  get callbacks(): ChatStateCallbacks {
    return this._callbacks;
  }

  set callbacks(value: ChatStateCallbacks) {
    this._callbacks = value;
  }

  // ============================================
  // Messages
  // ============================================

  get messages(): ChatMessage[] {
    return [...this.state.messages];
  }

  set messages(value: ChatMessage[]) {
    this.state.messages = value;
    this.state.totalMessageCount = this.state.olderMessageCount + value.length;
    this.state.hasOlderMessages = this.state.olderMessageCount > 0;
    this.rebuildMessageIndexes(value);
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata(),
      type: 'messages.replace',
      messages: value,
    });
  }

  addMessage(msg: ChatMessage): void {
    const isNew = !this.messagesById.has(msg.id);
    this.state.messages.push(msg);
    this.messagesById.set(msg.id, msg);
    this.indexMessageOwners(msg);
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata({ messageId: msg.id }),
      type: 'message.upsert',
      messageId: msg.id,
      message: msg,
      delivery: 'immediate',
    });
    if (isNew) {
      this.state.totalMessageCount += 1;
    }
  }

  clearMessages(): void {
    this.state.messages = [];
    this.state.hasOlderMessages = false;
    this.state.totalMessageCount = 0;
    this.state.olderMessageCount = 0;
    this.state.olderUserMessageCount = 0;
    this.rebuildMessageIndexes([]);
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata(),
      type: 'messages.replace',
      messages: [],
    });
  }

  get olderUserMessageCount(): number {
    return this.state.olderUserMessageCount;
  }

  get hasOlderMessages(): boolean {
    return this.state.hasOlderMessages;
  }

  set hasOlderMessages(value: boolean) {
    this.state.hasOlderMessages = value;
  }

  get totalMessageCount(): number {
    return this.state.totalMessageCount;
  }

  set totalMessageCount(value: number) {
    this.state.totalMessageCount = value;
  }

  get olderMessageCount(): number {
    return this.state.olderMessageCount;
  }

  set olderMessageCount(value: number) {
    this.state.olderMessageCount = value;
  }

  set olderUserMessageCount(value: number) {
    this.state.olderUserMessageCount = value;
  }

  truncateAt(messageId: string): number {
    const idx = this.state.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return 0;
    const removed = this.state.messages.length - idx;
    this.state.messages = this.state.messages.slice(0, idx);
    this.state.totalMessageCount = this.state.olderMessageCount + this.state.messages.length;
    this.rebuildMessageIndexes(this.state.messages);
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata(),
      type: 'messages.truncate',
      messageIds: this.state.messages.map(message => message.id),
    });
    return removed;
  }

  /** Queue one mutated durable message for frame-coalesced React publication. */
  notifyMessageChanged(
    message: ChatMessage,
    change: ChatProjectionMessageChange = { type: 'message.upsert' },
    runScope: ChatProjectionRunScope = {},
  ): void {
    this.messagesById.set(message.id, message);
    this.indexMessageOwners(message);
    const metadata = this.nextProjectionMetadata({
      messageId: message.id,
      blockId: change.type === 'text.append' ? change.blockId : null,
      toolId: change.type === 'tool.upsert' ? change.tool.id : null,
      agentId: change.type === 'agent.upsert'
        ? change.agent.agentId ?? change.agent.id
        : null,
    }, runScope);
    switch (change.type) {
      case 'message.upsert':
        this.projectionStore.dispatch({
          ...metadata,
          type: 'message.upsert',
          messageId: message.id,
          message,
          delivery: 'queued',
        });
        break;
      case 'text.append':
        this.projectionStore.dispatch({
          ...metadata,
          type: 'text.append',
          messageId: message.id,
          blockId: change.blockId,
          message,
          delta: change.delta,
        });
        break;
      case 'tool.upsert':
        this.projectionStore.dispatch({
          ...metadata,
          type: 'tool.upsert',
          messageId: message.id,
          toolId: change.tool.id,
          message,
          tool: change.tool,
        });
        break;
      case 'agent.upsert': {
        const agentId = change.agent.agentId ?? change.agent.id;
        this.projectionStore.dispatch({
          ...metadata,
          type: 'agent.upsert',
          messageId: message.id,
          agentId,
          message,
          agent: change.agent,
        });
        break;
      }
    }
    this.uiStore.update({ currentThinkingContent: this.currentThinkingContent });
  }

  flushProjection(): void {
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata(),
      type: 'projection.flush',
    });
  }

  completeProjectionRun(runScope: ChatProjectionRunScope = {}): void {
    this.projectionStore.dispatch({
      ...this.nextProjectionMetadata({}, runScope),
      type: 'run.terminal',
    });
  }

  private nextProjectionMetadata(
    ids: Partial<{
      messageId: string | null;
      blockId: string | null;
      toolId: string | null;
      agentId: string | null;
    }> = {},
    runScope: ChatProjectionRunScope = {},
  ): ChatProjectionEventMetadata & {
    messageId: string | null;
    blockId: string | null;
    toolId: string | null;
    agentId: string | null;
  } {
    const sessionFile = this.getProjectionSessionFile();
    const openSessionId = this.state.currentOpenSessionId;
    const ownerKey = `${this.projectionScopeId}\u0000${sessionFile ?? ''}\u0000${openSessionId ?? ''}`;
    if (ownerKey !== this.projectionOwnerKey) {
      this.projectionOwnerKey = ownerKey;
      this.projectionSequence = 0;
    }
    this.projectionSequence += 1;
    const parentRunId = `${this.projectionScopeId}:run:${this.state.streamGeneration}`;
    const childRunId = runScope.childRunId?.trim();
    return {
      projectionScopeId: this.projectionScopeId,
      sessionFile,
      openSessionId,
      runId: childRunId ? `${parentRunId}:agent:${childRunId}` : parentRunId,
      parentRunId: childRunId ? parentRunId : null,
      sequence: this.projectionSequence,
      timestamp: this.projectionNow(),
      messageId: ids.messageId ?? null,
      blockId: ids.blockId ?? null,
      toolId: ids.toolId ?? null,
      agentId: ids.agentId ?? null,
    };
  }

  prependPreviousProjectionPage(): boolean {
    return this.projectionStore.prependPreviousPage();
  }

  prependMessagePage(page: SessionMessagePage): boolean {
    if (this.projectionStore.hasPreviousPage()) return false;
    const existingIds = new Set(this.state.messages.map(message => message.id));
    const prepended = page.messages.filter(message => !existingIds.has(message.id));
    if (prepended.length > 0) {
      this.projectionStore.prependPage(prepended);
      this.state.messages = [...prepended, ...this.state.messages];
      this.rebuildMessageIndexes(this.state.messages);
    }
    this.state.hasOlderMessages = page.hasOlder;
    this.state.totalMessageCount = page.totalMessageCount;
    this.state.olderMessageCount = page.olderMessageCount;
    this.state.olderUserMessageCount = page.olderUserMessageCount;
    return prepended.length > 0;
  }

  /** Apply the pure stream projector to both durable state and the React snapshot. */
  projectStreamChunk(message: ChatMessage, chunk: StreamChunk): ChatMessage {
    const durableMessage = this.messagesById.get(message.id) ?? message;
    const projection = {
      ...createChatStreamSnapshot(durableMessage),
      currentTextContent: this.state.currentTextContent,
      currentThinkingContent: this.currentThinkingContent,
      usage: this.state.usage,
    };
    if (chunk.type === 'usage') return durableMessage;
    const reduced = reduceChatStreamSnapshot(projection, chunk);
    if (reduced === projection) return durableMessage;

    Object.assign(durableMessage, reduced.message);
    this.state.messages = [...this.state.messages];
    this.messagesById.set(durableMessage.id, durableMessage);
    this.state.currentTextContent = reduced.currentTextContent;
    this.currentThinkingContent = reduced.currentThinkingContent;
    this.state.usage = reduced.usage;
    return durableMessage;
  }

  findOwnerMessage(input: {
    subagentId?: string | null;
    agentId?: string | null;
    toolId?: string | null;
  }): ChatMessage | null {
    const messageId = (input.subagentId ? this.ownerMessageBySubagentId.get(input.subagentId) : null)
      ?? (input.agentId ? this.ownerMessageByAgentId.get(input.agentId) : null)
      ?? (input.toolId ? this.ownerMessageByToolId.get(input.toolId) : null);
    return messageId ? this.messagesById.get(messageId) ?? null : null;
  }

  private rebuildMessageIndexes(messages: readonly ChatMessage[]): void {
    this.messagesById.clear();
    this.ownerMessageBySubagentId.clear();
    this.ownerMessageByAgentId.clear();
    this.ownerMessageByToolId.clear();
    this.ownerKeysByMessageId.clear();
    for (const message of messages) {
      this.messagesById.set(message.id, message);
      this.indexMessageOwners(message);
    }
  }

  private indexMessageOwners(message: ChatMessage): void {
    const previous = this.ownerKeysByMessageId.get(message.id);
    if (previous) {
      for (const id of previous.subagentIds) this.ownerMessageBySubagentId.delete(id);
      for (const id of previous.agentIds) this.ownerMessageByAgentId.delete(id);
      for (const id of previous.toolIds) this.ownerMessageByToolId.delete(id);
    }
    const keys = {
      subagentIds: new Set<string>(),
      agentIds: new Set<string>(),
      toolIds: new Set<string>(),
    };
    for (const block of message.contentBlocks ?? []) {
      if (block.type === 'subagent') keys.subagentIds.add(block.subagentId);
      if (block.type === 'tool_use') keys.toolIds.add(block.toolId);
    }
    for (const toolCall of message.toolCalls ?? []) {
      keys.toolIds.add(toolCall.id);
      if (toolCall.subagent) {
        keys.subagentIds.add(toolCall.subagent.id);
        if (toolCall.subagent.agentId) keys.agentIds.add(toolCall.subagent.agentId);
      }
    }
    for (const id of keys.subagentIds) this.ownerMessageBySubagentId.set(id, message.id);
    for (const id of keys.agentIds) this.ownerMessageByAgentId.set(id, message.id);
    for (const id of keys.toolIds) this.ownerMessageByToolId.set(id, message.id);
    this.ownerKeysByMessageId.set(message.id, keys);
  }

  // ============================================
  // Streaming Control
  // ============================================

  get isStreaming(): boolean {
    return this.state.isStreaming;
  }

  set isStreaming(value: boolean) {
    this.state.isStreaming = value;
    this.uiStore.update({ isStreaming: value });
  }

  get cancelRequested(): boolean {
    return this.state.cancelRequested;
  }

  set cancelRequested(value: boolean) {
    this.state.cancelRequested = value;
    this.uiStore.update({ cancelRequested: value });
  }

  get streamGeneration(): number {
    return this.state.streamGeneration;
  }

  bumpStreamGeneration(): number {
    this.state.streamGeneration += 1;
    this.uiStore.update({ streamGeneration: this.state.streamGeneration });
    return this.state.streamGeneration;
  }

  get isCreatingSession(): boolean {
    return this.state.isCreatingSession;
  }

  set isCreatingSession(value: boolean) {
    this.state.isCreatingSession = value;
    this.uiStore.update({ isCreatingSession: value });
  }

  get isSwitchingSession(): boolean {
    return this.state.isSwitchingSession;
  }

  set isSwitchingSession(value: boolean) {
    this.state.isSwitchingSession = value;
    this.uiStore.update({ isSwitchingSession: value });
  }

  get hasPendingSessionSave(): boolean {
    return this.state.hasPendingSessionSave;
  }

  set hasPendingSessionSave(value: boolean) {
    this.state.hasPendingSessionSave = value;
    this.uiStore.update({ hasPendingSessionSave: value });
  }

  // ============================================
  // OpenSessionState
  // ============================================

  get currentOpenSessionId(): string | null {
    return this.state.currentOpenSessionId;
  }

  set currentOpenSessionId(value: string | null) {
    this.state.currentOpenSessionId = value;
    this.uiStore.update({ currentOpenSessionId: value });
  }

  // ============================================
  // Queued Message
  // ============================================

  get queuedMessage(): QueuedMessage | null {
    return this.state.queuedMessage;
  }

  set queuedMessage(value: QueuedMessage | null) {
    this.state.queuedMessage = value;
    this.uiStore.update({
      queuedTurn: value
        ? {
            content: value.content,
            imageCount: value.images?.length ?? 0,
            hasEditorContext: value.editorContext !== null,
            hasBrowserContext: value.browserContext != null,
            hasCanvasContext: value.canvasContext !== null,
          }
        : null,
    });
  }

  // ============================================
  // Streaming presentation state (reducer-local; not published to React)
  // ============================================

  get currentTextContent(): string {
    return this.state.currentTextContent;
  }

  set currentTextContent(value: string) {
    this.state.currentTextContent = value;
  }


  // ============================================
  // Usage State
  // ============================================

  get usage(): UsageInfo | null {
    return this.state.usage;
  }

  set usage(value: UsageInfo | null) {
    this.state.usage = value;
    this.uiStore.update({ usage: value });
  }

  get ignoreUsageUpdates(): boolean {
    return this.state.ignoreUsageUpdates;
  }

  set ignoreUsageUpdates(value: boolean) {
    this.state.ignoreUsageUpdates = value;
    this.uiStore.update({ ignoreUsageUpdates: value });
  }

  // ============================================
  // Current Todos (for persistent bottom panel)
  // ============================================

  get currentTodos(): TodoItem[] | null {
    return this.state.currentTodos ? [...this.state.currentTodos] : null;
  }

  set currentTodos(value: TodoItem[] | null) {
    // Normalize empty arrays to null for consistency
    const normalizedValue = (value && value.length > 0) ? value : null;
    this.state.currentTodos = normalizedValue;
    this.state.currentTodoVisualizationModel = normalizedValue
      ? deriveTodoVisualizationModel(normalizedValue, 'manual')
      : null;
    this.uiStore.update({
      currentTodoVisualizationModel: this.state.currentTodoVisualizationModel,
    });
  }

  get currentTodoVisualizationModel(): TodoVisualizationModel | null {
    return this.state.currentTodoVisualizationModel
      ? {
          ...this.state.currentTodoVisualizationModel,
          items: [...this.state.currentTodoVisualizationModel.items],
          progress: { ...this.state.currentTodoVisualizationModel.progress },
        }
      : null;
  }

  set currentTodoVisualizationModel(value: TodoVisualizationModel | null) {
    const normalizedValue = value && value.items.length > 0 ? value : null;
    this.state.currentTodoVisualizationModel = normalizedValue;
    this.state.currentTodos = normalizedValue ? normalizedValue.items : null;
    this.uiStore.update({
      currentTodoVisualizationModel: normalizedValue,
    });
  }

  // ============================================
  // Attention State (inline prompt, error, etc.)
  // ============================================

  get needsAttention(): boolean {
    return this.state.needsAttention;
  }

  set needsAttention(value: boolean) {
    this.state.needsAttention = value;
    this.uiStore.update({ needsAttention: value });
  }

  // ============================================
  // Auto-Scroll Control
  // ============================================

  get autoScrollEnabled(): boolean {
    return this.state.autoScrollEnabled;
  }

  set autoScrollEnabled(value: boolean) {
    const changed = this.state.autoScrollEnabled !== value;
    this.state.autoScrollEnabled = value;
    if (changed) {
      this.uiStore.update({ autoScrollEnabled: value });
    }
  }

  get welcomeGreeting(): string | null {
    return this.state.welcomeGreeting;
  }

  set welcomeGreeting(value: string | null) {
    this.state.welcomeGreeting = value;
    this.uiStore.update({ welcomeGreeting: value });
  }

  get navigationVisible(): boolean {
    return this.state.navigationVisible;
  }

  set navigationVisible(value: boolean) {
    if (this.state.navigationVisible === value) return;
    this.state.navigationVisible = value;
    this.uiStore.update({ navigationVisible: value });
  }

  // ============================================
  // Response Timer State
  // ============================================

  get responseStartTime(): number | null {
    return this.state.responseStartTime;
  }

  set responseStartTime(value: number | null) {
    this.state.responseStartTime = value;
    this.uiStore.update({ responseStartTime: value });
  }


  resetStreamingState(): void {
    this.state.currentTextContent = '';
    this.currentThinkingContent = '';
    this.state.isStreaming = false;
    this.state.cancelRequested = false;
    this.state.responseStartTime = null;
    this.uiStore.update({
      currentThinkingContent: '',
      thinkingIndicator: null,
      isStreaming: false,
      cancelRequested: false,
      responseStartTime: null,
    });
  }

  clearMaps(): void {}

  resetForNewSession(): void {
    this.clearMessages();
    this.resetStreamingState();
    this.clearMaps();
    this.state.queuedMessage = null;
    this.usage = null;
    this.currentTodos = null;
    this.autoScrollEnabled = true;
  }

  getPersistedMessages(): ChatMessage[] {
    // Return messages as-is - image data is single source of truth
    return this.state.messages;
  }

}

export { createInitialState };
