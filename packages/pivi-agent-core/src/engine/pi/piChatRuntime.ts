import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import { getProviderAuthFailureHint } from '@pivi/pivi-agent-core/auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { buildPiToolRegistry, type PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import { PiAgentEventAdapter } from '@pivi/pivi-agent-core/engine/pi/piAgentEventAdapter';
import {
  piAiModels,
  refreshCustomPiProviderModels,
} from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { createPiAuxQueryRunner, type PiAuxQueryRunner } from '@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner';
import { toPiImageContent } from '@pivi/pivi-agent-core/engine/pi/piImageContent';
import { resolvePiModel, resolvePiProviderAuth } from '@pivi/pivi-agent-core/engine/pi/piModelEnv';
import { isPiModelContextWindowAuthoritative } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/piRuntimeHost';
import { resolvePiThinkingLevelForModel } from '@pivi/pivi-agent-core/engine/pi/piThinkingLevels';
import { toPiAgentTool } from '@pivi/pivi-agent-core/engine/pi/piToolAdapter';
import type { MissingAgentMessagesOptions } from '@pivi/pivi-agent-core/engine/pi/session/agentMessageHistory';
import { sanitizeAgentMessagesForLlm } from '@pivi/pivi-agent-core/engine/pi/session/agentMessageHistory';
import {
  buildCompactionPrompt,
  buildCompactionSummary,
  COMPACTION_SYSTEM_PROMPT,
  DEFAULT_COMPACTION_CONTEXT_WINDOW,
  estimateAgentMessagesTokens,
  estimateTextTokens,
  getCompactionThresholdTokens,
  selectCompactionCutPoint,
  shouldAutoCompact,
  stripCompactCommand,
} from '@pivi/pivi-agent-core/engine/pi/session/piContextCompaction';
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
  appendExternalContextAvailability,
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from '@pivi/pivi-agent-core/prompt';
import { testEndpointConnectivity } from '@pivi/pivi-agent-core/runtime/connectivity';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import { prepareChatTurn } from '@pivi/pivi-agent-core/runtime/prepareTurn';
import { toChatTurnRequestSnapshot } from '@pivi/pivi-agent-core/runtime/queuedTurn';
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
import { TOOL_SPAWN_AGENT } from '@pivi/pivi-agent-core/tools';


export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
}

interface ActiveTurn {
  queue: StreamChunkQueue;
  acceptingSubagentChunks: boolean;
  subagentToolIds: Set<string>;
}

const POST_LOAD_MODEL_METADATA_PROVIDER_IDS = new Set([
  'ollama',
  'lmstudio',
  'llama-cpp',
]);

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
  private autoCompactionInFlight = false;
  private lastAutoCompactionAttemptLeafId: string | null = null;
  private readonly subagentRunner: PiAuxQueryRunner;
  private readonly subagentChunkListeners = new Set<(chunk: StreamChunk) => void | Promise<void>>();
  private readonly readyState = new RuntimeReadyState((error) => {
    console.warn('Pivi: ready listener threw', error);
  });
  private openSessionAgentState: Record<string, unknown> | undefined;
  private externalContextPaths: string[] = [];
  private readonly postLoadModelRefreshSuccesses = new Set<string>();

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly network: PiChatRuntimeNetwork,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
    private readonly baseToolProvider: PiBaseToolProvider | null = null,
  ) {
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager ? new PiMcpBridge(mcpManager, mcpOAuth, network.mcpFetch, network.mcpProcessEnv) : null;
    this.subagentRunner = createPiAuxQueryRunner(plugin, (chunk) => {
      this.dispatchSubagentChunk(chunk);
    }, () => this.buildSubagentTools());
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

  onSubagentChunk(listener: (chunk: StreamChunk) => void | Promise<void>): () => void {
    this.subagentChunkListeners.add(listener);
    return () => {
      this.subagentChunkListeners.delete(listener);
    };
  }

  syncSession(
    ref: { sessionFile: string | null; leafId?: string | null } | null,
    externalContextPaths?: string[],
  ): void {
    this.setExternalContextPaths(externalContextPaths ?? []);
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
    // Warm bridge tool cache so slash/runtime and system-prompt inventory are ready.
    await this.mcpBridge?.prefetchEnabledTools();
    this.syncMcpTools();
  }

  async syncSystemPrompt(): Promise<void> {
    if (!this.agent) {
      await this.ensureReady();
      return;
    }

    this.syncAgentTools();
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
    this.subagentRunner.cleanupIdleSubagents();
    this.setExternalContextPaths(turn.request.externalContextPaths ?? []);

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

    if (turn.isCompact) {
      try {
        const compacted = await this.compactCurrentSession('manual', stripCompactCommand(turn.request.text));
        yield compacted
          ? { type: 'context_compacted' }
          : { type: 'notice', level: 'info', content: 'There is not enough session history to compact yet.' };
      } catch (error) {
        yield { type: 'error', content: error instanceof Error ? error.message : String(error) };
      }
      yield { type: 'done' };
      return;
    }

    // Re-check selected roots after readiness/tool sync. This status is dynamic
    // and belongs in every API turn, not in durable user-message history.
    const registry = this.buildToolRegistry();
    this.agent.state.tools = registry.tools;
    this.applySystemPrompt(registry);
    const effectiveTurn: PreparedChatTurn = {
      ...turn,
      prompt: appendExternalContextAvailability(turn.prompt, registry.externalContexts),
    };

    this.applyThinkingLevelFromSettings();

    if (this.activeTurn) {
      this.closeTurnQueue(this.activeTurn);
    }
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      acceptingSubagentChunks: true,
      subagentToolIds: new Set<string>(),
    };
    this.currentTurnMetadata = {};

    const activeTurn = this.activeTurn;
    const agent = this.agent;
    const emittedMessages: AgentMessage[] = [];
    let didCompactDuringTurn = false;

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
        } else if ((event.message as { role?: unknown }).role === 'toolResult') {
          const estimatedUsage = this.buildEstimatedUsageInfo(emittedMessages);
          if (estimatedUsage) {
            activeTurn.queue.push({ type: 'usage', usage: estimatedUsage });
          }
        }
      }
      if (event.type === 'agent_end') {
        try {
          this.syncSessionMessagesAfterTurn(event.messages.length > 0 ? event.messages : emittedMessages, effectiveTurn);
        } catch (error) {
          console.warn('Pivi: failed to sync agent messages after turn', error);
        }
        return;
      }
      const chunks = this.eventAdapter.adapt(event);
      for (const chunk of chunks) {
        this.trackActiveTurnSubagentTool(activeTurn, chunk);
        activeTurn.queue.push(chunk);
      }
    });

    const promptImages = toPiImageContent(turn.request.images);
    const promptPromise = (async () => {
      const preflightCompacted = await this.prepareContextForTurn(effectiveTurn, activeTurn.queue);
      if (preflightCompacted === null) {
        this.finishTurnQueue(activeTurn);
        return;
      }
      didCompactDuringTurn = preflightCompacted;

      try {
        if (this.sessionTree) {
          const parentEntryId = this.sessionTree.getLeafId();
          const userEntryId = this.sessionTree.appendUserMessage(
            turn.persistedContent,
            turn.request.images,
          );
          this.sessionTree.appendMessageUi({
            targetEntryId: userEntryId,
            displayContent: turn.request.text,
            turnRequest: toChatTurnRequestSnapshot(turn.request),
          });
          this.currentTurnMetadata.userParentEntryId = parentEntryId;
          this.currentTurnMetadata.userMessageId = userEntryId;
          this.leafId = this.sessionTree.getLeafId();
        }
      } catch (error) {
        console.warn('Pivi: failed to persist user message before prompt', error);
      }

      await (promptImages.length > 0
        ? agent.prompt(effectiveTurn.prompt, promptImages)
        : agent.prompt(effectiveTurn.prompt));
      const refreshedModelMetadata = await this.refreshLocalModelMetadataAfterPrompt(agent);

      try {
        this.syncSessionMessagesAfterTurn(emittedMessages.length > 0 ? emittedMessages : agent.state.messages, effectiveTurn);
      } catch (error) {
        console.warn('Pivi: failed to sync final agent state after turn', error);
      }
      const usage = this.latestUsageFromMessages(emittedMessages.length > 0 ? emittedMessages : agent.state.messages);
      if (refreshedModelMetadata && usage) {
        // Replace the first turn's pre-load context estimate with the runtime
        // window discovered after the local server loaded the model.
        activeTurn.queue.push({ type: 'usage', usage });
      }
      if (!didCompactDuringTurn && usage && this.shouldAutoCompact(usage)) {
        activeTurn.queue.push({ type: 'context_compacting' });
        try {
          const compacted = await this.compactCurrentSession('threshold');
          if (compacted) {
            didCompactDuringTurn = true;
            activeTurn.queue.push({ type: 'context_compacted' });
          }
        } catch (error) {
          activeTurn.queue.push({
            type: 'notice',
            level: 'warning',
            content: `Auto compaction failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      this.finishTurnQueue(activeTurn);
    })().catch((error: unknown) => {
      activeTurn.queue.push({
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      });
      this.finishTurnQueue(activeTurn);
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
      activeTurn.acceptingSubagentChunks = false;
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    this.agent?.abort();
    this.subagentRunner.abortAllSubagents();
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
    if (this.activeTurn) {
      this.closeTurnQueue(this.activeTurn);
    }
    this.subagentRunner.reset();
    this.subagentRunner.abortAllSubagents();
    this.agent?.reset();
    this.agent = null;
    void this.mcpBridge?.dispose();
    this.systemPromptKey = null;
    this.setReady(false);
  }

  async loadSubagentToolCalls(agentId: string) {
    return this.subagentRunner.loadSubagentToolCalls(agentId);
  }

  async loadSubagentFinalResult(agentId: string): Promise<string | null> {
    return this.subagentRunner.loadSubagentFinalResult(agentId);
  }

  async rewind(checkpointId: string | null): Promise<ChatRewindResult> {
    if (this.activeTurn) {
      return { canRewind: false, error: 'Cannot redo while a turn is streaming.' };
    }

    this.ensureSessionTree({ allowSessionCreation: false });
    if (!this.sessionTree) {
      return { canRewind: false, error: 'No active session to rewind.' };
    }

    if (!this.sessionTree.truncateAfter(checkpointId)) {
      return { canRewind: false, error: 'Rewind checkpoint was not found.' };
    }

    this.leafId = this.sessionTree.getLeafId();
    this.currentTurnMetadata = {};
    this.invalidateAgentSession();
    return { canRewind: true, leafId: this.leafId };
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
        externalContextPaths: this.externalContextPaths,
        subagentQueryRunner: this.subagentRunner,
      });
    }
    return buildPiToolRegistry({
      host: this.plugin,
      vaultPath,
      mcpBridge: this.mcpBridge,
      baseToolProvider: this.baseToolProvider,
      externalContextPaths: this.externalContextPaths,
      subagentQueryRunner: this.subagentRunner,
    });
  }

  private buildSubagentTools(): AgentTool[] {
    const vaultPath = this.getVaultPath();
    if (!vaultPath || !this.baseToolProvider) {
      return [];
    }
    const providedBaseTools = this.baseToolProvider({
      vaultPath,
      externalContextPaths: this.externalContextPaths,
    });
    const baseTools = providedBaseTools.toolSpecs
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT);
    const mcpTools = this.mcpBridge?.getToolSpecs()
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT) ?? [];
    return [...baseTools, ...mcpTools];
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

  private syncSessionMessagesAfterTurn(messages: AgentMessage[], turn?: PreparedChatTurn): void {
    if (!this.sessionTree || messages.length === 0) {
      return;
    }
    this.sessionTree.syncAgentMessages(messages, this.buildTurnSyncOptions(turn));
    this.leafId = this.sessionTree.getLeafId();
    this.currentTurnMetadata.assistantMessageId = this.sessionTree.findLastVisibleMessageEntryId('assistant')
      ?? this.currentTurnMetadata.assistantMessageId;
  }

  private buildTurnSyncOptions(turn?: PreparedChatTurn): MissingAgentMessagesOptions | undefined {
    if (!turn || turn.persistedContent === turn.prompt) {
      return undefined;
    }
    return {
      userMessageEquivalences: [{
        existingText: turn.persistedContent,
        incomingText: turn.prompt,
      }],
    };
  }

  private closeTurnQueue(activeTurn: ActiveTurn): void {
    activeTurn.acceptingSubagentChunks = false;
    activeTurn.queue.close();
  }

  private finishTurnQueue(activeTurn: ActiveTurn): void {
    activeTurn.acceptingSubagentChunks = false;
    activeTurn.queue.push({ type: 'done' });
    activeTurn.queue.close();
  }

  private trackActiveTurnSubagentTool(activeTurn: ActiveTurn, chunk: StreamChunk): void {
    if (chunk.type === 'tool_use' && chunk.name === TOOL_SPAWN_AGENT) {
      activeTurn.subagentToolIds.add(chunk.id);
    }
  }

  private getSubagentOwnerToolId(chunk: StreamChunk): string | null {
    return 'subagentId' in chunk && typeof chunk.subagentId === 'string'
      ? chunk.subagentId
      : null;
  }

  private dispatchSubagentChunk(chunk: StreamChunk): void {
    const activeTurn = this.activeTurn;
    const subagentToolId = this.getSubagentOwnerToolId(chunk);
    if (
      activeTurn?.acceptingSubagentChunks
      && subagentToolId
      && activeTurn.subagentToolIds.has(subagentToolId)
    ) {
      activeTurn.queue.push(chunk);
      return;
    }

    for (const listener of this.subagentChunkListeners) {
      Promise.resolve(listener(chunk)).catch((error: unknown) => {
        console.warn('Pivi: subagent chunk listener threw', error);
      });
    }
  }

  private latestUsageFromMessages(messages: AgentMessage[]): UsageInfo | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message) {
        continue;
      }
      const usage = this.buildUsageInfo(message);
      if (usage) {
        return usage;
      }
    }
    return null;
  }

  private buildEstimatedUsageInfo(messages: AgentMessage[]): UsageInfo | null {
    const contextTokens = estimateAgentMessagesTokens(messages);
    if (contextTokens <= 0) {
      return null;
    }
    const resolvedModel = this.resolveModel();
    const contextWindow = resolvedModel?.contextWindow ?? 0;
    return {
      contextTokens,
      contextWindow,
      contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
      inputTokens: contextTokens,
      ...(resolvedModel?.maxTokens ? { outputTokenLimit: resolvedModel.maxTokens } : {}),
      ...(typeof resolvedModel?.id === 'string' ? { model: resolvedModel.id } : {}),
      percentage: contextWindow > 0
        ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
        : 0,
    };
  }

  private shouldAutoCompact(providerUsage: UsageInfo): boolean {
    if (!this.sessionTree) {
      return false;
    }
    return shouldAutoCompact({
      enableAutoCompact: this.plugin.settings.enableAutoCompact,
      compactionInFlight: this.autoCompactionInFlight,
      sessionLeafId: this.sessionTree.getLeafId(),
      lastAttemptLeafId: this.lastAutoCompactionAttemptLeafId,
      providerUsage,
      storedConversationTokens: this.estimateStoredConversationTokens(),
      thresholdRatio: this.plugin.settings.autoCompactThresholdRatio,
    });
  }

  private getCompactionThresholdTokens(contextWindow = this.resolveContextWindow()): number {
    return getCompactionThresholdTokens(contextWindow, this.plugin.settings.autoCompactThresholdRatio);
  }

  private resolveContextWindow(): number {
    return this.resolveModel()?.contextWindow ?? DEFAULT_COMPACTION_CONTEXT_WINDOW;
  }

  private estimateStoredConversationTokens(): number {
    if (!this.sessionTree) {
      return 0;
    }
    return estimateAgentMessagesTokens(this.sessionTree.loadAgentMessages());
  }

  private estimateProjectedTurnTokens(turn: PreparedChatTurn): number {
    const sessionTokens = this.sessionTree
      ? estimateAgentMessagesTokens(this.sessionTree.loadAgentMessages())
      : estimateAgentMessagesTokens(this.agent?.state.messages ?? []);
    return sessionTokens + estimateTextTokens(turn.prompt);
  }

  private canCompactCurrentSession(): boolean {
    if (!this.sessionTree) {
      return false;
    }
    return selectCompactionCutPoint(
      this.sessionTree.getLinearLlmContextEntries(),
      this.plugin.settings.autoCompactKeepRecentTokens,
    ) !== null;
  }

  private async prepareContextForTurn(
    turn: PreparedChatTurn,
    queue: StreamChunkQueue,
  ): Promise<boolean | null> {
    if (!this.plugin.settings.enableAutoCompact || !this.sessionTree) {
      return false;
    }

    if (!isPiModelContextWindowAuthoritative(this.resolveModel())) {
      return false;
    }

    const thresholdTokens = this.getCompactionThresholdTokens();
    if (this.estimateProjectedTurnTokens(turn) <= thresholdTokens) {
      return false;
    }

    let compacted = false;
    if (this.canCompactCurrentSession()) {
      queue.push({ type: 'context_compacting' });
      compacted = await this.compactCurrentSession('threshold', 'Preflight compaction before sending the next user turn because the projected context would exceed the configured threshold.');
      if (compacted) {
        queue.push({ type: 'context_compacted' });
      }
    }

    if (this.estimateProjectedTurnTokens(turn) <= thresholdTokens) {
      return compacted;
    }

    queue.push({
      type: 'error',
      content: 'This turn is too large to send safely within the configured context threshold. Reduce attached context, use obsidian_read with line ranges, or deliberately raise maxChars only for files you need in full.',
    });
    return null;
  }

  private async compactCurrentSession(
    reason: 'manual' | 'threshold',
    instructions?: string,
  ): Promise<boolean> {
    if (!this.sessionTree) {
      return false;
    }
    const attemptLeafId = this.sessionTree.getLeafId();
    if (reason === 'threshold') {
      if (!attemptLeafId || this.lastAutoCompactionAttemptLeafId === attemptLeafId) {
        return false;
      }
    }

    const entries = this.sessionTree.getLinearLlmContextEntries();
    const cutPoint = selectCompactionCutPoint(
      entries,
      this.plugin.settings.autoCompactKeepRecentTokens,
    );
    if (!cutPoint) {
      return false;
    }

    this.autoCompactionInFlight = true;
    try {
      const runner = createPiAuxQueryRunner(this.plugin);
      try {
        const summaryText = await runner.query({
          model: this.getAuxiliaryModel() ?? undefined,
          systemPrompt: COMPACTION_SYSTEM_PROMPT,
        }, buildCompactionPrompt(cutPoint.prefixEntries, instructions));
        const summary = buildCompactionSummary(summaryText);
        const compactionId = this.sessionTree.appendCompaction(
          summary,
          cutPoint.firstKeptEntryId,
          cutPoint.tokensBefore,
        );
        this.leafId = this.sessionTree.getLeafId();
        this.currentTurnMetadata.assistantMessageId = compactionId;
        if (reason === 'threshold') {
          this.lastAutoCompactionAttemptLeafId = this.sessionTree.getLeafId();
        }
        if (this.agent) {
          this.agent.state.messages = this.sessionTree.loadAgentMessages();
        }
        return true;
      } finally {
        runner.reset();
      }
    } finally {
      this.autoCompactionInFlight = false;
    }
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
    const contextWindow = resolvedModel?.contextWindow ?? 0;
    const outputTokenLimit = resolvedModel?.maxTokens;
    return {
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextTokens,
      contextWindow,
      contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
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

  private setExternalContextPaths(paths: readonly string[]): void {
    const next = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (next.length === this.externalContextPaths.length && next.every((path, index) => path === this.externalContextPaths[index])) {
      return;
    }
    this.externalContextPaths = next;
    this.toolRegistryKey = null;
    this.syncAgentTools();
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

  private async refreshLocalModelMetadataAfterPrompt(agent: Agent): Promise<boolean> {
    const model = agent.state.model;
    if (!model || !POST_LOAD_MODEL_METADATA_PROVIDER_IDS.has(model.provider)) {
      return false;
    }
    const modelKey = `${model.provider}/${model.id}`;
    if (this.postLoadModelRefreshSuccesses.has(modelKey)) {
      return false;
    }
    try {
      if (await refreshCustomPiProviderModels(model.provider)) {
        this.postLoadModelRefreshSuccesses.add(modelKey);
        const refreshedModel = this.resolveModel();
        if (
          refreshedModel?.provider === model.provider
          && refreshedModel.id === model.id
        ) {
          agent.state.model = refreshedModel;
          return true;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Pivi: failed to refresh ${model.provider} model metadata after first prompt: ${message}`);
    }
    return false;
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
