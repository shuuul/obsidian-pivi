import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import { requestUrl } from 'obsidian';

import type PiviPlugin from '../../main';
import type { McpServerManager } from '../../pi/mcp/McpServerManager';
import { buildTurnPrompt, finalizeTurnPrompt } from '../../pi/runtime/buildTurnPrompt';
import type { ChatRuntime } from '../../pi/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  ChatRewindResult,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../pi/runtime/types';
import { SessionApprovalRules } from '../../pi/security/SessionApprovalRules';
import type {
  ChatMessage,
  OpenSessionState,
  StreamChunk,
} from '../../pi/types';
import { getVaultPath } from '../../utils/path';
import type { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { PiMcpBridge } from '../mcp/PiMcpBridge';
import { piAiModels } from '../piAiModels';
import { sanitizeAgentMessagesForLlm } from '../session/agentMessageHistory';
import { SessionTreeStore } from '../session/SessionTreeStore';
import { buildPiToolRegistry } from '../tools/buildAgentToolRegistry';
import { resolvePiThinkingLevel } from '../ui/piThinkingLevels';
import {
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from './buildPiSystemPrompt';
import { PiAgentEventAdapter } from './PiAgentEventAdapter';
import { resolvePiModel, resolvePiProviderAuth } from './piModelEnv';

interface ActiveTurn {
  queue: StreamChunkQueue;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

const SESSION_FILE_KEY = 'piSessionFile';

function getSessionFileFromAgentState(
  agentState?: Record<string, unknown>,
): string | undefined {
  const value = agentState?.[SESSION_FILE_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function withoutSessionFileInAgentState(
  agentState?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!agentState || !(SESSION_FILE_KEY in agentState)) {
    return agentState;
  }
  const { [SESSION_FILE_KEY]: _legacySessionFile, ...rest } = agentState;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export class PiChatRuntime implements ChatRuntime {
  private activeTurn: ActiveTurn | null = null;
  private agent: Agent | null = null;
  private sessionId: string | null = null;
  private systemPromptKey: string | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly eventAdapter = new PiAgentEventAdapter();
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly mcpManager: McpServerManager | null;
  private readonly mcpBridge: PiMcpBridge | null;
  private approvalCallback: ApprovalCallback | null = null;
  private readonly sessionApprovalRules = new SessionApprovalRules();
  private toolRegistryKey: string | null = null;
  private sessionTree: SessionTreeStore | null = null;
  private sessionFile: string | null = null;
  private leafId: string | null = null;
  private openSessionAgentState: Record<string, unknown> | undefined;

  constructor(
    private readonly plugin: PiviPlugin,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
  ) {
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager ? new PiMcpBridge(mcpManager, mcpOAuth) : null;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const built = buildTurnPrompt(request);
    const finalized = finalizeTurnPrompt(built, request, this.mcpManager);
    const mcpMentions = this.mergeMcpMentions(finalized.mcpMentions, request.enabledMcpServers);
    return {
      isCompact: built.isCompact,
      mcpMentions,
      persistedContent: finalized.persistedContent,
      prompt: finalized.prompt,
      request,
    };
  }

  getAuxiliaryModel(): string | null {
    const model = this.plugin.settings.titleGenerationModel?.trim();
    return model || this.plugin.settings.model?.trim() || null;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  syncOpenSessionState(
    openSession: {
      agentState?: Record<string, unknown>;
      sessionId?: string | null;
      sessionFile?: string;
      leafId?: string | null;
    } | null,
    _externalContextPaths?: string[],
  ): void {
    const prevSessionFile = this.sessionFile;
    const prevLeafId = this.sessionTree?.getLeafId() ?? this.leafId;
    const nextSessionId = openSession?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.sessionId = nextSessionId;
    }
    this.openSessionAgentState = openSession?.agentState;
    const sessionFile = openSession?.sessionFile
      ?? getSessionFileFromAgentState(openSession?.agentState);
    this.sessionFile = sessionFile ?? null;
    if (!openSession || this.sessionFile !== prevSessionFile) {
      this.sessionApprovalRules.clear();
    }
    const requestedLeafId = openSession && Object.prototype.hasOwnProperty.call(openSession, 'leafId')
      ? (openSession.leafId ?? null)
      : undefined;
    this.leafId = requestedLeafId ?? null;
    const vaultPath = this.getVaultPath();
    if (vaultPath && sessionFile) {
      this.sessionTree = SessionTreeStore.open(vaultPath, sessionFile, requestedLeafId);
      this.sessionFile = this.sessionTree.getVaultRelativeSessionFile() ?? sessionFile;
      this.sessionId = this.sessionTree.getSessionId();
      this.leafId = this.sessionTree.getLeafId();
    } else {
      this.sessionTree = null;
    }

    const nextLeafId = this.sessionTree?.getLeafId() ?? this.leafId;
    if (this.agent && (prevSessionFile !== this.sessionFile || prevLeafId !== nextLeafId)) {
      this.invalidateAgentSession();
    }
  }

  async reloadMcpServers(): Promise<void> {
    await this.mcpBridge?.reload();
    this.syncMcpTools();
  }

  async syncSystemPrompt(): Promise<void> {
    if (!this.agent) {
      await this.ensureReady();
      return;
    }

    this.applySystemPrompt();
  }

  syncThinkingLevel(): void {
    this.applyThinkingLevelFromSettings();
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const model = this.resolveModel();
    if (!model) {
      console.error('Could not resolve Pi model from settings.');
      this.setReady(false);
      return false;
    }

    const auth = await this.resolveAuth(model);
    if (!auth) {
      if (model.provider === 'openai-codex') {
        console.error('OpenAI Codex OAuth credentials are missing or unavailable. Reconnect OpenAI Codex in provider settings.');
      } else {
        const expectedVar = this.getExpectedApiKeyVar(model.provider);
        console.error(`API key not found for provider: ${model.provider}. Set the environment variable ${expectedVar} in plugin settings.`);
      }
      this.setReady(false);
      return false;
    }

    this.ensureSessionTree(options);

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.syncAgentTools();
      return true;
    }

    const registry = this.buildToolRegistry();
    const systemPrompt = buildPiSystemPrompt(this.plugin, registry);
    const sessionMessages = this.sessionTree?.loadAgentMessages() ?? [];

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools: registry.tools,
        messages: sessionMessages,
        thinkingLevel: this.resolveThinkingLevelForModel(model),
      },
      convertToLlm: (messages) => sanitizeAgentMessagesForLlm(messages),
      streamFn: (streamModel, context, options) => piAiModels.streamSimple(streamModel, context, options),
      sessionId: this.sessionId ?? undefined,
    });

    this.systemPromptKey = computePiSystemPromptKey(this.plugin, registry);
    this.toolRegistryKey = registry.registeredToolsSection;
    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _openSessionHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      const model = this.resolveModel();
      const providerHint = model
        ? this.getProviderAuthFailureHint(model.provider)
        : 'Check your model selection in settings.';
      yield { type: 'error', content: `Failed to initialize Pi Agent. ${providerHint}` };
      yield { type: 'done' };
      return;
    }

    if (!this.agent) {
      yield { type: 'error', content: 'Pi Agent is not ready.' };
      yield { type: 'done' };
      return;
    }

    this.applyThinkingLevelFromSettings();

    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
    };
    this.currentTurnMetadata = {};

    const activeTurn = this.activeTurn;
    const agent = this.agent;
    const emittedMessages: AgentMessage[] = [];

    if (this.mcpBridge) {
      this.mcpBridge.setActiveMentions(this.mcpBridge.resolveActiveMentions(turn));
    }

    // Subscribe to agent events and push StreamChunks into the queue
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_end') {
        emittedMessages.push(event.message);
      }
      if (event.type === 'agent_end') {
        try {
          this.syncSessionMessagesAfterTurn(event.messages.length > 0 ? event.messages : emittedMessages);
        } catch (error) {
          console.warn('Pivi: failed to sync agent messages after turn', error);
        }
      }
      const chunks = this.eventAdapter.adapt(event);
      for (const chunk of chunks) {
        activeTurn.queue.push(chunk);
      }
    });

    try {
      if (this.sessionTree) {
        const parentEntryId = this.sessionTree.getLeafId();
        const userEntryId = this.sessionTree.appendUserMessage(
          turn.prompt,
          turn.request.images,
        );
        this.sessionTree.appendMessageUi({
          targetEntryId: userEntryId,
          displayContent: turn.request.text,
        });
        this.currentTurnMetadata.userParentEntryId = parentEntryId;
        this.currentTurnMetadata.userMessageId = userEntryId;
        this.leafId = this.sessionTree.getLeafId();
      }
    } catch (error) {
      console.warn('Pivi: failed to persist user message before prompt', error);
    }

    const promptImages = this.toPiImageContent(turn.request.images);
    const promptPromise = (
      promptImages.length > 0
        ? agent.prompt(turn.prompt, promptImages)
        : agent.prompt(turn.prompt)
    ).then(() => {
      try {
        this.syncSessionMessagesAfterTurn(emittedMessages.length > 0 ? emittedMessages : agent.state.messages);
      } catch (error) {
        console.warn('Pivi: failed to sync final agent state after turn', error);
      }
      activeTurn.queue.close();
    }).catch((error: unknown) => {
      activeTurn.queue.push({
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    });

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await promptPromise;
    } finally {
      unsubscribe();
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    this.agent?.abort();
  }

  resetSession(): void {
    this.invalidateAgentSession();
    this.sessionId = null;
    this.sessionApprovalRules.clear();
  }

  getSessionId(): string | null {
    return this.sessionId ?? this.agent?.sessionId ?? null;
  }

  consumeSessionInvalidation(): boolean {
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.sessionApprovalRules.clear();
    this.setReady(false);
  }

  async rewind(checkpointId: string | null): Promise<ChatRewindResult> {
    if (!this.sessionTree) {
      return { canRewind: false, error: 'No active session tree' };
    }
    if (!this.sessionTree.setLeaf(checkpointId)) {
      return { canRewind: false, error: 'Checkpoint not found' };
    }

    const sessionId = this.sessionTree.getSessionId();
    this.leafId = this.sessionTree.getLeafId();
    this.resetSession();
    this.sessionId = sessionId;
    const ok = await this.ensureReady({ force: true, allowSessionCreation: false });
    return ok
      ? { canRewind: true, leafId: this.leafId }
      : { canRewind: false, leafId: this.leafId, error: 'Failed to rebuild session' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
    this.syncAgentTools();
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(_params: {
    openSession: OpenSessionState | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const sessionFile = this.sessionTree?.getVaultRelativeSessionFile()
      ?? this.sessionFile;

    return {
      updates: {
        sessionId: this.getSessionId(),
        sessionFile: sessionFile ?? undefined,
        leafId: this.leafId,
        agentState: withoutSessionFileInAgentState(this.openSessionAgentState),
      },
    };
  }

  resolveSessionIdForFork(openSession: OpenSessionState | null): string | null {
    return this.getSessionId() ?? openSession?.sessionId ?? null;
  }

  async testConnectivity(): Promise<ConnectivityTestResult> {
    const model = this.resolveModel();
    if (!model) {
      return { ok: false, detail: 'No model configured.' };
    }

    const provider = model.provider;
    const auth = await this.resolveAuth(model);
    if (!auth) {
      return { ok: false, detail: `No credentials for provider: ${provider}` };
    }

    const baseUrl = model.baseUrl as string | undefined;
    if (!baseUrl) {
      return { ok: false, detail: 'Model has no baseUrl configured.' };
    }

    try {
      const response = await requestUrl({
        url: baseUrl,
        method: 'HEAD',
        throw: false,
      });
      return { ok: true, detail: `${baseUrl} responded with status ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: `${baseUrl}: ${message}` };
    }
  }

  private mergeMcpMentions(
    mentions: Set<string>,
    enabledMcpServers?: Set<string>,
  ): Set<string> {
    if (!enabledMcpServers || enabledMcpServers.size === 0) {
      return mentions;
    }
    return new Set([...mentions, ...enabledMcpServers]);
  }

  private toPiImageContent(images: ChatMessage['images']): ImageContent[] {
    return (images ?? []).map((image) => ({
      type: 'image',
      data: image.data,
      mimeType: image.mediaType,
    }));
  }

  private syncMcpTools(): void {
    this.syncAgentTools();
  }

  private syncAgentTools(): void {
    if (!this.agent) {
      return;
    }
    const registry = this.buildToolRegistry();
    this.agent.state.tools = registry.tools;
    this.toolRegistryKey = registry.registeredToolsSection;
    this.applySystemPrompt(registry);
  }

  private buildToolRegistry() {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return buildPiToolRegistry({
        plugin: this.plugin,
        app: this.plugin.app,
        vaultPath: '',
        mcpBridge: this.mcpBridge,
        approvalCallback: this.approvalCallback,
        sessionApprovalRules: this.sessionApprovalRules,
      });
    }
    return buildPiToolRegistry({
      plugin: this.plugin,
      app: this.plugin.app,
      vaultPath,
      mcpBridge: this.mcpBridge,
      approvalCallback: this.approvalCallback,
      sessionApprovalRules: this.sessionApprovalRules,
    });
  }

  private ensureSessionTree(options?: ChatRuntimeEnsureReadyOptions): void {
    if (this.sessionTree) {
      return;
    }
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return;
    }
    const existingFile = this.sessionFile
      ?? getSessionFileFromAgentState(this.openSessionAgentState);
    if (existingFile) {
      this.sessionTree = SessionTreeStore.open(vaultPath, existingFile, this.leafId ?? undefined);
      this.sessionFile = this.sessionTree.getVaultRelativeSessionFile();
      this.leafId = this.sessionTree.getLeafId();
      this.sessionId = this.sessionTree.getSessionId();
      return;
    }
    if (options?.allowSessionCreation === false) {
      return;
    }
    this.sessionTree = SessionTreeStore.create(vaultPath);
    this.sessionFile = this.sessionTree.getVaultRelativeSessionFile();
    this.leafId = this.sessionTree.getLeafId();
    this.sessionId = this.sessionTree.getSessionId();
  }

  private invalidateAgentSession(): void {
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.toolRegistryKey = null;
    this.setReady(false);
  }

  private syncSessionMessagesAfterTurn(messages: AgentMessage[]): void {
    if (!this.sessionTree || messages.length === 0) {
      return;
    }
    this.sessionTree.syncAgentMessages(messages);
    this.leafId = this.sessionTree.getLeafId();
    this.currentTurnMetadata.assistantMessageId = this.findLastMessageEntryId('assistant')
      ?? this.currentTurnMetadata.assistantMessageId;
  }

  private findLastMessageEntryId(role: 'user' | 'assistant'): string | null {
    const branch = this.sessionTree?.getBranch() ?? [];
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type !== 'message') {
        continue;
      }
      if (entry.message.role === role) {
        return entry.id;
      }
    }
    return null;
  }

  private getVaultPath(): string | null {
    return getVaultPath(this.plugin.app);
  }

  private applySystemPrompt(registry?: ReturnType<typeof buildPiToolRegistry>): void {
    const resolvedRegistry = registry ?? this.buildToolRegistry();
    const nextKey = computePiSystemPromptKey(this.plugin, resolvedRegistry);
    if (this.systemPromptKey === nextKey) {
      return;
    }

    if (this.agent) {
      this.agent.state.systemPrompt = buildPiSystemPrompt(this.plugin, resolvedRegistry);
    }
    this.systemPromptKey = nextKey;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.readyListeners) {
      try {
        listener(ready);
      } catch (error) {
        console.warn('Pivi: ready listener threw', error);
      }
    }
  }

  private resolveThinkingLevelForModel(
    model: NonNullable<ReturnType<typeof resolvePiModel>>,
  ): ThinkingLevel {
    return resolvePiThinkingLevel(
      `${model.provider}/${model.id}`,
      this.plugin.settings.thinkingLevel,
    );
  }

  private applyThinkingLevelFromSettings(): void {
    if (!this.agent) {
      return;
    }
    const model = this.resolveModel();
    if (!model) {
      return;
    }
    this.agent.state.thinkingLevel = this.resolveThinkingLevelForModel(model);
  }

  /**
   * Resolve a pi-ai Model object from plugin settings.
   *
   * Settings store models as "<provider>/<modelId>".
   */
  private resolveModel(): ReturnType<typeof resolvePiModel> {
    return resolvePiModel(this.plugin);
  }

  private async resolveAuth(model: NonNullable<ReturnType<typeof resolvePiModel>>) {
    try {
      return await resolvePiProviderAuth(this.plugin, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Pivi: failed to resolve provider auth for ${model.provider}: ${message}`);
      return undefined;
    }
  }

  private getExpectedApiKeyVar(provider: string): string {
    const keyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GEMINI_API_KEY',
      'google-vertex': 'GEMINI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      opencode: 'OPENCODE_API_KEY',
      'opencode-go': 'OPENCODE_API_KEY',
    };
    return keyMap[provider] ?? `${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`;
  }

  private getProviderAuthFailureHint(provider: string): string {
    if (provider === 'openai-codex') {
      return 'Provider: openai-codex. Reconnect OpenAI Codex OAuth in provider settings.';
    }
    return `Provider: ${provider}. Expected env var: ${this.getExpectedApiKeyVar(provider)}`;
  }
}
