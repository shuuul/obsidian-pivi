import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import { getProviderAuthFailureHint } from '@pivi/pivi-agent-core/auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { buildPiToolRegistry, type PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import { PiAgentEventAdapter } from '@pivi/pivi-agent-core/engine/pi/piAgentEventAdapter';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { toPiImageContent } from '@pivi/pivi-agent-core/engine/pi/piImageContent';
import { resolvePiModel, resolvePiProviderAuth } from '@pivi/pivi-agent-core/engine/pi/piModelEnv';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/piRuntimeHost';
import { resolvePiThinkingLevelForModel } from '@pivi/pivi-agent-core/engine/pi/piThinkingLevels';
import { sanitizeAgentMessagesForLlm } from '@pivi/pivi-agent-core/engine/pi/session/agentMessageHistory';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import type {
  ChatMessage,
  OpenSessionState,
  StreamChunk,
  UsageInfo,
} from '@pivi/pivi-agent-core/foundation';
import type { McpOAuthService, McpServerManager } from '@pivi/pivi-agent-core/mcp';
import { PiMcpBridge } from '@pivi/pivi-agent-core/mcp';
import type { McpProcessEnv, McpTransportFetch } from '@pivi/pivi-agent-core/mcp/ports';
import type { HttpClient } from '@pivi/pivi-agent-core/ports';
import {
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from '@pivi/pivi-agent-core/prompt/buildPiSystemPrompt';
import { testEndpointConnectivity } from '@pivi/pivi-agent-core/runtime/connectivity';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import { prepareChatTurn } from '@pivi/pivi-agent-core/runtime/prepareTurn';
import { RuntimeReadyState } from '@pivi/pivi-agent-core/runtime/runtimeReadyState';
import {
  buildSessionStateUpdates,
  getLegacySessionFileFromAgentState,
} from '@pivi/pivi-agent-core/runtime/sessionStateProjection';
import { StreamChunkQueue } from '@pivi/pivi-agent-core/runtime/streamChunkQueue';
import type {
  ChatRewindResult,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PiEnsureReadyOptions,
  PiTurnOptions,
  PreparedChatTurn,
} from '@pivi/pivi-agent-core/runtime/types';


export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
}

interface ActiveTurn {
  queue: StreamChunkQueue;
}



export class PiChatRuntime implements PiChatService {
  private activeTurn: ActiveTurn | null = null;
  private agent: Agent | null = null;
  private sessionId: string | null = null;
  private systemPromptKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter();
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly mcpManager: McpServerManager | null;
  private readonly mcpBridge: PiMcpBridge | null;
  private toolRegistryKey: string | null = null;
  private sessionTree: SessionTreeStore | null = null;
  private sessionFile: string | null = null;
  private leafId: string | null = null;
  private readonly readyState = new RuntimeReadyState((error) => {
    console.warn('Pivi: ready listener threw', error);
  });
  private openSessionAgentState: Record<string, unknown> | undefined;

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly network: PiChatRuntimeNetwork,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
    private readonly baseToolProvider: PiBaseToolProvider | null = null,
  ) {
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager ? new PiMcpBridge(mcpManager, mcpOAuth, network.mcpFetch, network.mcpProcessEnv) : null;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return prepareChatTurn(request, this.mcpManager);
  }

  getAuxiliaryModel(): string | null {
    const model = this.plugin.settings.titleGenerationModel?.trim();
    return model || this.plugin.settings.model?.trim() || null;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    return this.readyState.onReadyStateChange(listener);
  }

  syncSession(
    ref: { sessionFile: string | null; leafId?: string | null } | null,
    _externalContextPaths?: string[],
  ): void {
    const prevSessionFile = this.sessionFile;
    const sessionFile = ref?.sessionFile ?? null;
    this.sessionFile = sessionFile ?? null;
    this.leafId = null;
    const vaultPath = this.getVaultPath();
    if (vaultPath && sessionFile) {
      this.sessionTree = SessionTreeStore.open(vaultPath, sessionFile);
      this.sessionFile = this.sessionTree.getVaultRelativeSessionFile() ?? sessionFile;
      this.sessionId = this.sessionTree.getSessionId();
      this.leafId = this.sessionTree.getLeafId();
    } else {
      this.sessionTree = null;
    }

    if (this.agent && prevSessionFile !== this.sessionFile) {
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

  async ensureReady(options?: PiEnsureReadyOptions): Promise<boolean> {
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
        const expectedVar = getProviderEnvVarNames(model.provider).apiKeyVar;
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
    const systemPrompt = buildPiSystemPrompt(this.getVaultPath() ?? undefined, this.plugin.settings.userName, registry);
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

    this.systemPromptKey = computePiSystemPromptKey(this.getVaultPath() ?? undefined, this.plugin.settings.userName, registry);
    this.toolRegistryKey = registry.registeredToolsSection;
    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _openSessionHistory?: ChatMessage[],
    _queryOptions?: PiTurnOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      const model = this.resolveModel();
      const providerHint = model
        ? getProviderAuthFailureHint(model.provider)
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
        const usage = this.buildUsageInfo(event.message);
        if (usage) {
          activeTurn.queue.push({ type: 'usage', usage });
        }
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

    const promptImages = toPiImageContent(turn.request.images);
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
  }

  getSessionId(): string | null {
    return this.sessionId ?? this.agent?.sessionId ?? null;
  }


  isReady(): boolean {
    return this.readyState.isReady();
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.setReady(false);
  }

  async rewind(checkpointId: string | null): Promise<ChatRewindResult> {
    void checkpointId;
    return { canRewind: false, error: 'Rewind is disabled; fork from this message instead.' };
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  getSessionStateUpdates(): Partial<OpenSessionState> {
    const sessionFile = this.sessionTree?.getVaultRelativeSessionFile()
      ?? this.sessionFile;

    return buildSessionStateUpdates({
      sessionId: this.getSessionId(),
      sessionFile,
      agentState: this.openSessionAgentState,
    });
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

    return testEndpointConnectivity(this.network.httpClient, baseUrl, {
      isReachableStatus: () => true,
    });
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
        host: this.plugin,
        vaultPath: '',
        mcpBridge: this.mcpBridge,
        baseToolProvider: this.baseToolProvider,
      });
    }
    return buildPiToolRegistry({
      host: this.plugin,
      vaultPath,
      mcpBridge: this.mcpBridge,
      baseToolProvider: this.baseToolProvider,
    });
  }

  private ensureSessionTree(options?: PiEnsureReadyOptions): void {
    if (this.sessionTree) {
      return;
    }
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return;
    }
    const existingFile = this.sessionFile
      ?? getLegacySessionFileFromAgentState(this.openSessionAgentState);
    if (existingFile) {
      this.sessionTree = SessionTreeStore.open(vaultPath, existingFile);
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
    this.currentTurnMetadata.assistantMessageId = this.sessionTree.findLastVisibleMessageEntryId('assistant')
      ?? this.currentTurnMetadata.assistantMessageId;
  }


  private buildUsageInfo(message: AgentMessage): UsageInfo | null {
    const msg = message as unknown as Record<string, unknown>;
    if (msg.role !== 'assistant') {
      return null;
    }
    const usage = this.getRecord(msg.usage);
    const inputTokens = this.getNumber(usage.input);
    const outputTokens = this.getNumber(usage.output);
    const cacheReadInputTokens = this.getNumber(usage.cacheRead) ?? 0;
    const cacheCreationInputTokens = this.getNumber(usage.cacheWrite) ?? 0;
    const contextTokens = inputTokens === null
      ? this.getNumber(usage.totalTokens)
      : inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
    if (contextTokens === null || contextTokens <= 0) {
      return null;
    }

    const resolvedModel = this.resolveModel();
    const contextWindow = resolvedModel?.contextWindow ?? 200_000;
    const outputTokenLimit = resolvedModel?.maxTokens;
    return {
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextTokens,
      contextWindow,
      contextWindowIsAuthoritative: Boolean(resolvedModel?.contextWindow),
      inputTokens: inputTokens ?? contextTokens,
      ...(typeof msg.model === 'string' ? { model: msg.model } : {}),
      ...(outputTokenLimit ? { outputTokenLimit } : {}),
      ...(outputTokens !== null ? { outputTokens } : {}),
      percentage: contextWindow > 0
        ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
        : 0,
    };
  }

  private getRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private getNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }


  private getVaultPath(): string | null {
    return this.plugin.getVaultPath();
  }

  private applySystemPrompt(registry?: ReturnType<typeof buildPiToolRegistry>): void {
    const resolvedRegistry = registry ?? this.buildToolRegistry();
    const nextKey = computePiSystemPromptKey(this.getVaultPath() ?? undefined, this.plugin.settings.userName, resolvedRegistry);
    if (this.systemPromptKey === nextKey) {
      return;
    }

    if (this.agent) {
      this.agent.state.systemPrompt = buildPiSystemPrompt(this.getVaultPath() ?? undefined, this.plugin.settings.userName, resolvedRegistry);
    }
    this.systemPromptKey = nextKey;
  }

  private setReady(ready: boolean): void {
    this.readyState.setReady(ready);
  }

  private resolveThinkingLevelForModel(
    model: NonNullable<ReturnType<typeof resolvePiModel>>,
  ): ThinkingLevel {
    return resolvePiThinkingLevelForModel(
      model,
      typeof this.plugin.settings.thinkingLevel === 'string' ? this.plugin.settings.thinkingLevel : undefined,
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

}
