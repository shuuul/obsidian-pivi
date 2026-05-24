import { Agent } from '@earendil-works/pi-agent-core';
import * as piAi from '@earendil-works/pi-ai';

import type { RuntimeCapabilities } from '../../core/agent/types';
import type { McpServerManager } from '../../core/mcp/McpServerManager';
import { buildTurnPrompt, finalizeTurnPrompt } from '../../core/runtime/buildTurnPrompt';
import type { ChatRuntime } from '../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
} from '../../core/types';
import type ObsiusPlugin from '../../main';
import { PI_RUNTIME_CAPABILITIES } from '../capabilities';
import type { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { PiMcpBridge } from '../mcp/PiMcpBridge';
import {
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from './buildPiSystemPrompt';
import { PiAgentEventAdapter } from './PiAgentEventAdapter';
import { resolvePiApiKey, resolvePiModel } from './piModelEnv';

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

  constructor(
    private readonly plugin: ObsiusPlugin,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
  ) {
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager ? new PiMcpBridge(mcpManager, mcpOAuth) : null;
  }

  getCapabilities(): Readonly<RuntimeCapabilities> {
    return PI_RUNTIME_CAPABILITIES;
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

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: { agentState?: Record<string, unknown>; sessionId?: string | null } | null,
  ): void {
    const nextSessionId = conversation?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.sessionId = nextSessionId;
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

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const model = this.resolveModel();
    if (!model) {
      console.error('Could not resolve Pi model from settings.');
      this.setReady(false);
      return false;
    }

    const apiKey = this.resolveApiKey(model.provider as string);
    if (!apiKey) {
      const expectedVar = this.getExpectedApiKeyVar(model.provider as string);
      console.error(`API key not found for provider: ${model.provider}. Set the environment variable ${expectedVar} in plugin settings.`);
      this.setReady(false);
      return false;
    }

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.applySystemPrompt();
      this.syncMcpTools();
      return true;
    }

    const systemPrompt = buildPiSystemPrompt(this.plugin);
    const tools = this.mcpBridge?.getAgentTools() ?? [];

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools,
        messages: [],
        thinkingLevel: 'medium',
      },
      convertToLlm: (messages) => messages as any[],
      streamFn: piAi.streamSimple,
      getApiKey: (provider: string) => {
        return this.resolveApiKey(provider);
      },
      sessionId: this.sessionId ?? undefined,
    });

    this.systemPromptKey = computePiSystemPromptKey(this.plugin);
    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      const model = this.resolveModel();
      const providerHint = model
        ? `Provider: ${model.provider}. Expected env var: ${this.getExpectedApiKeyVar(model.provider as string)}`
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

    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
    };
    this.currentTurnMetadata = {};

    const activeTurn = this.activeTurn;
    const agent = this.agent;

    if (this.mcpBridge) {
      this.mcpBridge.setActiveMentions(this.mcpBridge.resolveActiveMentions(turn));
    }

    // Subscribe to agent events and push StreamChunks into the queue
    const unsubscribe = agent.subscribe((event) => {
      const chunks = this.eventAdapter.adapt(event);
      for (const chunk of chunks) {
        activeTurn.queue.push(chunk);
      }
    });

    const promptPromise = agent.prompt(turn.prompt).then(() => {
      // agent_end event already pushes 'done' via the adapter — just close
      // the queue. Errors are already surfaced via the message_end adapter.
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
    this.agent?.reset();
    this.sessionId = null;
    this.agent = null;
    this.systemPromptKey = null;
    this.setReady(false);
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

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.setReady(false);
  }

  async rewind(_userMessageId: string, _assistantMessageId: string, _mode?: ChatRewindMode): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((runtimeMode: string) => void) | null): void {}
  setSubagentHookState(_getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return {
      updates: {
        sessionId: this.getSessionId(),
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.getSessionId() ?? conversation?.sessionId ?? null;
  }

  async testConnectivity(): Promise<ConnectivityTestResult> {
    const model = this.resolveModel();
    if (!model) {
      return { ok: false, detail: 'No model configured.' };
    }

    const provider = model.provider as string;
    const apiKey = this.resolveApiKey(provider);
    if (!apiKey) {
      return { ok: false, detail: `No API key for provider: ${provider}` };
    }

    const baseUrl = model.baseUrl as string | undefined;
    if (!baseUrl) {
      return { ok: false, detail: 'Model has no baseUrl configured.' };
    }

    try {
      const response = await fetch(baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
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

  private syncMcpTools(): void {
    if (!this.agent || !this.mcpBridge) {
      return;
    }
    this.agent.state.tools = this.mcpBridge.getAgentTools();
  }

  private applySystemPrompt(): void {
    const nextKey = computePiSystemPromptKey(this.plugin);
    if (this.systemPromptKey === nextKey) {
      return;
    }

    if (this.agent) {
      this.agent.state.systemPrompt = buildPiSystemPrompt(this.plugin);
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
      } catch {
        // ignore errors from listeners
      }
    }
  }

  /**
   * Resolve a pi-ai Model object from plugin settings.
   *
   * Settings store models as "<provider>/<modelId>".
   */
  private resolveModel(): ReturnType<typeof resolvePiModel> {
    return resolvePiModel(this.plugin);
  }

  private resolveApiKey(provider: string): string | undefined {
    return resolvePiApiKey(this.plugin, provider);
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
}
