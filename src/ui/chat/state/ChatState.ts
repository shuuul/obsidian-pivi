import type { StreamChunk, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { deriveTodoVisualizationModel } from '@pivi/pivi-agent-core/tools';
import {
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

function createInitialState(): ChatStateData {
  return {
    messages: [],
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
  private _callbacks: ChatStateCallbacks;
  readonly uiStore: ChatUiStore;

  constructor(callbacks: ChatStateCallbacks = {}) {
    this.state = createInitialState();
    this._callbacks = callbacks;
    this.uiStore = new ChatUiStore(createInitialChatUiSnapshot());
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
    this.uiStore.update({ messages: value });
  }

  addMessage(msg: ChatMessage): void {
    this.state.messages.push(msg);
    this.uiStore.update({ messages: this.state.messages });
  }

  clearMessages(): void {
    this.state.messages = [];
    this.uiStore.update({ messages: [] });
  }

  truncateAt(messageId: string): number {
    const idx = this.state.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return 0;
    const removed = this.state.messages.length - idx;
    this.state.messages = this.state.messages.slice(0, idx);
    this.uiStore.update({ messages: this.state.messages });
    return removed;
  }

  /** Publish legacy in-place message mutations to the immutable React snapshot. */
  notifyMessagesChanged(): void {
    this.uiStore.update({ messages: this.state.messages });
  }

  /** Apply the pure stream projector to both durable state and the React snapshot. */
  projectStreamChunk(message: ChatMessage, chunk: StreamChunk): ChatMessage {
    const snapshot = this.uiStore.getSnapshot();
    const durableMessage = this.state.messages.find(existing => existing.id === message.id) ?? message;
    const projection = {
      ...createChatStreamSnapshot(durableMessage),
      currentTextContent: this.state.currentTextContent,
      currentThinkingContent: snapshot.currentThinkingContent,
      usage: this.state.usage,
    };
    if (chunk.type === 'usage') return durableMessage;
    const reduced = reduceChatStreamSnapshot(projection, chunk);
    if (reduced === projection) return durableMessage;

    Object.assign(durableMessage, reduced.message);
    this.state.messages = [...this.state.messages];
    this.state.currentTextContent = reduced.currentTextContent;
    this.state.usage = reduced.usage;
    this.uiStore.update({
      messages: this.state.messages,
      currentThinkingContent: reduced.currentThinkingContent,
      usage: reduced.usage,
    });
    return durableMessage;
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
