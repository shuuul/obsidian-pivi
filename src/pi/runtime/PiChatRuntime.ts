import { Agent, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { requestUrl } from 'obsidian';

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
import { SessionApprovalRules } from '../../core/security/SessionApprovalRules';
import type {
  ChatMessage,
  ExitPlanModeCallback,
  OpenSessionState,
  SlashCommand,
  StreamChunk,
} from '../../core/types';
import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import { PI_RUNTIME_CAPABILITIES } from '../capabilities';
import type { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { PiMcpBridge } from '../mcp/PiMcpBridge';
import { piAiModels } from '../piAiModels';
import {
  getSessionFileFromAgentState,
  PiSessionBridge,
  withSessionFileInAgentState,
} from '../session/PiSessionBridge';
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
  private sessionBridge: PiSessionBridge | null = null;
  private sessionTree: SessionTreeStore | null = null;
  private sessionFile: string | null = null;
  private leafId: string | null = null;
  private openSessionAgentState: Record<string, unknown> | undefined;

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

  /** Pi runtime uses session tree rewind; host checkpoint IDs are not persisted yet. */
  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncOpenSessionState(
    openSession: {
      agentState?: Record<string, unknown>;
      sessionId?: string | null;
      sessionFile?: string;
      leafId?: string | null;
    } | null,
  ): void {
    const prevSessionFile = this.sessionFile;
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
    this.leafId = openSession?.leafId ?? null;
    const vaultPath = this.getVaultPath();
    if (vaultPath && sessionFile) {
      this.sessionBridge = new PiSessionBridge(vaultPath, sessionFile);
      this.sessionTree = SessionTreeStore.open(vaultPath, sessionFile, this.leafId ?? undefined);
      this.sessionId = this.sessionBridge.getSessionId() ?? this.sessionId;
      this.leafId = this.sessionTree.getLeafId();
    } else {
      this.sessionTree = null;
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
      const expectedVar = this.getExpectedApiKeyVar(model.provider);
      console.error(`API key not found for provider: ${model.provider}. Set the environment variable ${expectedVar} in plugin settings.`);
      this.setReady(false);
      return false;
    }

    this.ensureSessionBridge(options);

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.syncAgentTools();
      return true;
    }

    const registry = this.buildToolRegistry();
    const systemPrompt = buildPiSystemPrompt(this.plugin, registry);
    const sessionMessages = this.sessionTree?.loadAgentMessages()
      ?? this.sessionBridge?.loadAgentMessages()
      ?? [];

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools: registry.tools,
        messages: sessionMessages,
        thinkingLevel: this.resolveThinkingLevelForModel(model),
      },
      convertToLlm: (messages) => messages as Message[],
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
        ? `Provider: ${model.provider}. Expected env var: ${this.getExpectedApiKeyVar(model.provider)}`
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

    if (this.mcpBridge) {
      this.mcpBridge.setActiveMentions(this.mcpBridge.resolveActiveMentions(turn));
    }

    // Subscribe to agent events and push StreamChunks into the queue
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'agent_end') {
        try {
          this.sessionTree?.syncAgentMessages(event.messages);
          this.leafId = this.sessionTree?.getLeafId() ?? this.leafId;
        } catch (error) {
          console.warn('Obsius: failed to sync agent messages after turn', error);
        }
      }
      const chunks = this.eventAdapter.adapt(event);
      for (const chunk of chunks) {
        activeTurn.queue.push(chunk);
      }
    });

    try {
      if (this.sessionTree) {
        this.sessionTree.appendUserMessage(turn.prompt);
        this.leafId = this.sessionTree.getLeafId();
      } else {
        this.sessionBridge?.appendUserMessage(turn.prompt);
      }
    } catch (error) {
      console.warn('Obsius: failed to persist user message before prompt', error);
    }

    const promptPromise = agent.prompt(turn.prompt).then(() => {
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
    this.sessionApprovalRules.clear();
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

  getSupportedCommands(): Promise<SlashCommand[]> {
    return Promise.resolve([]);
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.sessionApprovalRules.clear();
    this.setReady(false);
  }

  async rewind(userMessageId: string, _assistantMessageId: string, _mode?: ChatRewindMode): Promise<ChatRewindResult> {
    if (!this.sessionTree) {
      return { canRewind: false };
    }
    this.sessionTree.setLeaf(userMessageId);
    this.leafId = userMessageId;
    this.resetSession();
    const ok = await this.ensureReady({ force: true });
    return { canRewind: ok };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
    this.syncAgentTools();
  }
  /** ChatRuntime port stubs — Pi adaptor does not implement Claude Code plan/approval hooks yet. */
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
    openSession: OpenSessionState | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const sessionFile = this.sessionTree?.getVaultRelativeSessionFile()
      ?? this.sessionBridge?.getSessionFile()
      ?? this.sessionFile;
    const agentState = sessionFile
      ? withSessionFileInAgentState(this.openSessionAgentState, sessionFile)
      : this.openSessionAgentState;

    return {
      updates: {
        sessionId: this.getSessionId(),
        sessionFile: sessionFile ?? undefined,
        leafId: this.leafId,
        agentState,
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

  private ensureSessionBridge(options?: ChatRuntimeEnsureReadyOptions): void {
    if (this.sessionBridge && this.sessionTree) {
      return;
    }
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return;
    }
    const existingFile = this.sessionFile
      ?? getSessionFileFromAgentState(this.openSessionAgentState);
    if (existingFile) {
      this.sessionBridge = new PiSessionBridge(vaultPath, existingFile);
      this.sessionTree = SessionTreeStore.open(vaultPath, existingFile, this.leafId ?? undefined);
      this.sessionFile = this.sessionTree.getVaultRelativeSessionFile();
      this.leafId = this.sessionTree.getLeafId();
      this.sessionId = this.sessionBridge.getSessionId();
      return;
    }
    if (options?.allowSessionCreation === false) {
      return;
    }
    this.sessionTree = SessionTreeStore.create(vaultPath);
    this.sessionFile = this.sessionTree.getVaultRelativeSessionFile();
    this.leafId = this.sessionTree.getLeafId();
    this.sessionBridge = new PiSessionBridge(vaultPath, this.sessionFile ?? undefined);
    this.sessionId = this.sessionBridge.getSessionId();
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
        console.warn('Obsius: ready listener threw', error);
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
      console.warn(`Obsius: failed to resolve provider auth for ${model.provider}: ${message}`);
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
}
