import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';

import { getProviderAuthFailureHint } from '../../auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import type { ContextLayers } from '../../context/loadContextLayers';
import type {
  ChatMessage,
  OpenSessionState,
  StreamChunk,
} from '../../foundation';
import { PluginLogger } from '../../foundation/pluginLogger';
import { calculateReadToolMaxChars, type ReadAllowanceReservation } from '../../foundation/usage';
import type { McpOAuthService, McpServerManager } from '../../mcp';
import type { PiMcpBridge } from '../../mcp';
import type { McpProcessEnv, McpTransportFetch } from '../../mcp/ports';
import type { HttpClient, SyncSecretStore } from '../../ports';
import type { CapabilityApprovalPort } from '../../ports/capabilityApproval';
import {
  appendExternalContextAvailability,
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from '../../prompt';
import { extractTextContent } from '../../runtime/messageContent';
import type { PiChatService } from '../../runtime/piChatService';
import { prepareChatTurn } from '../../runtime/prepareTurn';
import { toChatTurnRequestSnapshot } from '../../runtime/queuedTurn';
import { RuntimeReadyState } from '../../runtime/runtimeReadyState';
import {
  buildSessionStateUpdates,
  getLegacySessionFileFromAgentState,
} from '../../runtime/sessionStateProjection';
import type {
  ChatRewindResult,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PiEnsureReadyOptions,
  PiTurnOptions,
  PreparedChatTurn,
} from '../../runtime/types';
import { TOOL_SPAWN_AGENT } from '../../tools';
import {
  buildPiToolRegistry,
  type PiBaseToolProvider,
  type PiMainOnlyToolProvider,
} from './buildPiToolRegistryCore';
import { PiAgentEventAdapter, type PiChatErrorContext } from './piAgentEventAdapter';
import {
  refreshCustomPiProviderModels,
  streamPiAiModelsSimple,
} from './piAiModels';
import { createPiAuxQueryRunner, type PiAuxQueryRunner } from './piAuxQueryRunner';
import {
  type ActiveTurn,
  closeActiveTurnQueue,
  createActiveTurn,
  getSubagentOwnerToolId,
} from './piChatRuntimeActiveTurn';
import {
  attachContextEnvelope,
  buildUsageAfterCompaction,
  compactCurrentSession,
  invalidateCompactionState,
  type PiChatCompactionState,
  syncSessionMessagesAfterTurn,
} from './piChatRuntimeCompaction';
import { testPiChatConnectivity } from './piChatRuntimeConnectivity';
import { streamPiChatTurn } from './piChatRuntimeTurn';
import {
  buildEstimatedUsageInfo,
  buildZeroUsageInfoForModel,
  latestUsageFromMessages,
} from './piChatRuntimeUsage';
import { toPiImageContent } from './piImageContent';
import { resolvePiModel, resolvePiModelByKey, resolvePiProviderAuth } from './piModelEnv';
import type { PiResolvedModel } from './piModelRegistry';
import { createPiReadBudget } from './piReadBudget';
import type { PiRuntimeHost } from './piRuntimeHost';
import { resolvePiThinkingLevelForModel } from './piThinkingLevels';
import { toPiAgentTool } from './piToolAdapter';
import { sanitizeAgentMessagesForLlm } from './session/agentMessageHistory';
import { stripCompactCommand } from './session/piContextCompaction';
import type { PiSessionTree, PiSessionTreeFactory } from './session/piSessionTree';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';


export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
  mcpSecretStorage?: SyncSecretStore;
}

export type PiMcpBridgeFactory = (
  manager: McpServerManager,
  oauth: McpOAuthService | null,
  network: PiChatRuntimeNetwork,
  vaultPath?: string,
) => PiMcpBridge;

export type PiContextLayersFactory = (
  vaultPath: string,
  activeNotePath?: string | null,
) => ContextLayers;

const POST_LOAD_MODEL_METADATA_PROVIDER_IDS = new Set([
  'ollama',
  'lmstudio',
  'llama-cpp',
]);
const logger = new PluginLogger('PiChatRuntime');

export class PiChatRuntime implements PiChatService {
  private activeTurn: ActiveTurn | null = null;
  private agent: Agent | null = null;
  private sessionId: string | null = null;
  private systemPromptKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter(
    (message) => this.resolveErrorContext(message),
  );
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly mcpManager: McpServerManager | null;
  private readonly mcpBridge: PiMcpBridge | null;
  private toolRegistryKey: string | null = null;
  private sessionTree: PiSessionTree | null = null;
  private sessionGeneration = 0;
  /** In-flight tree create/open for the current generation; cleared on settle or invalidate. */
  private sessionTreeInit: { generation: number; promise: Promise<void> } | null = null;
  private sessionFile: string | null = null;
  private leafId: string | null = null;
  private readonly compactionState: PiChatCompactionState = {
    autoCompactionInFlight: false,
    failedAutoFingerprint: null,
    foregroundController: null,
    generation: 0,
    prefire: null,
  };
  private readonly subagentRunner: PiAuxQueryRunner;
  private readonly readBudget = createPiReadBudget(
    () => this.calculateReadMaxCharsForTools(),
  );
  private readonly subagentChunkListeners = new Set<(chunk: StreamChunk) => void | Promise<void>>();
  private readonly readyState = new RuntimeReadyState((error) => {
    logger.warn('ready listener threw', error);
  });
  private openSessionAgentState: Record<string, unknown> | undefined;
  private externalContextPaths: string[] = [];
  private readonly postLoadModelRefreshSuccesses = new Set<string>();
  private capabilityApproval: CapabilityApprovalPort | null = null;

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly network: PiChatRuntimeNetwork,
    private readonly sessionTreeFactory: PiSessionTreeFactory | null,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
    private readonly baseToolProvider: PiBaseToolProvider | null = null,
    private readonly subagentConcurrencyLimiter?: SubagentConcurrencyLimiter,
    capabilityApproval: CapabilityApprovalPort | null = null,
    /**
     * Main-Agent-only tools (e.g. pivi management). Optional; absent by default.
     * Never requested by {@link buildSubagentTools} — structural exclusion, not filtering.
     */
    private readonly mainOnlyToolProvider: PiMainOnlyToolProvider | null = null,
    mcpBridgeFactory?: PiMcpBridgeFactory,
    private readonly contextLayersFactory?: PiContextLayersFactory,
  ) {
    this.capabilityApproval = capabilityApproval;
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager && mcpBridgeFactory
      ? mcpBridgeFactory(
        mcpManager,
        mcpOAuth,
        network,
        this.getVaultPath() ?? undefined,
      )
      : null;
    this.subagentRunner = createPiAuxQueryRunner(plugin, {
      getTools: (resolveReadMaxChars) => this.buildSubagentTools(resolveReadMaxChars),
      onSubagentChunk: (chunk) => {
        this.dispatchSubagentChunk(chunk);
      },
      subagentConcurrencyLimiter,
    });
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return prepareChatTurn(request, this.mcpManager);
  }

  setCapabilityApproval(port: CapabilityApprovalPort | null): void {
    this.capabilityApproval = port;
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

    const sessionChanged = prevSessionFile !== this.sessionFile;
    if (sessionChanged || this.sessionTreeInit) {
      this.invalidatePendingSessionTree();
      if (sessionChanged && this.agent) {
        this.invalidateAgentSession();
      }
      invalidateCompactionState(this.compactionState);
    }
  }


  async reloadMcpServers(): Promise<void> {
    await this.mcpBridge?.reload();
    // Warm bridge tool cache so slash/runtime and system-prompt inventory are ready.
    await this.mcpBridge?.prefetchEnabledTools();
    this.syncMcpTools();
  }

  async syncSystemPrompt(): Promise<void> {
    this.subagentConcurrencyLimiter?.refreshCapacity();
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
    const generation = this.sessionGeneration;
    const model = this.resolveModel();
    if (!model) {
      logger.error('Could not resolve Pi model from settings');
      this.setReady(false);
      return false;
    }

    const auth = await this.resolveAuth(model);
    if (generation !== this.sessionGeneration) return false;
    if (!auth) {
      if (model.provider === 'openai-codex') {
        logger.error('OpenAI Codex OAuth credentials are missing or unavailable. Reconnect OpenAI Codex in provider settings.');
      } else {
        const expectedVar = getProviderEnvVarNames(model.provider).apiKeyVar;
        logger.error(`API key not found for provider: ${model.provider}. Set the environment variable ${expectedVar} in plugin settings.`);
      }
      this.setReady(false);
      return false;
    }

    await this.ensureSessionTree(options, generation);
    if (generation !== this.sessionGeneration) return false;

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.syncAgentModelSelection(model);
      this.syncAgentTools();
      return true;
    }
    if (this.agent && options?.force === true) {
      invalidateCompactionState(this.compactionState);
    }

    // Re-check after any await above: a losing generation must never construct Agent.
    if (generation !== this.sessionGeneration) return false;

    const registry = this.buildToolRegistry();
    const systemPrompt = buildPiSystemPrompt(this.getVaultPath() ?? undefined, this.plugin.settings.userName, registry);
    const sessionMessages = this.sessionTree?.loadAgentMessages() ?? [];

    if (generation !== this.sessionGeneration) return false;

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools: registry.tools,
        messages: sessionMessages,
        thinkingLevel: this.resolveThinkingLevelForModel(model),
      },
      convertToLlm: (messages) => sanitizeAgentMessagesForLlm(messages),
      streamFn: (streamModel, context, options) => streamPiAiModelsSimple(streamModel, context, options),
      sessionId: this.sessionId ?? undefined,
      steeringMode: 'one-at-a-time',
    });

    if (generation !== this.sessionGeneration) {
      // sync/reset/cleanup raced Agent construction; drop the orphan Agent.
      this.agent.reset();
      this.agent = null;
      return false;
    }

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
    this.readBudget.reset();
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
        const compacted = await compactCurrentSession(this.compactionDeps(), 'manual', stripCompactCommand(turn.request.text));
        if (compacted) {
          yield { type: 'context_compacted', ...compacted };
          const usage = buildUsageAfterCompaction(
            this.compactionDeps(),
            undefined,
            compacted.tokensAfter,
          );
          if (usage) {
            yield { type: 'usage', usage };
          }
        } else {
          yield { type: 'notice', level: 'info', content: 'There is not enough session history to compact yet.' };
        }
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
      closeActiveTurnQueue(this.activeTurn);
    }
    this.activeTurn = createActiveTurn();
    this.currentTurnMetadata = {};

    const activeTurn = this.activeTurn;
    const agent = this.agent;

    if (this.mcpBridge) {
      this.mcpBridge.setActiveMentions(this.mcpBridge.resolveActiveMentions(turn));
    }

    try {
      yield* streamPiChatTurn({
        activeTurn,
        agent,
        compaction: this.compactionDeps(),
        eventAdapter: this.eventAdapter,
        sessionTree: this.sessionTree,
        resolveModel: () => this.resolveModel(),
        resolveThinkingLevel: (model) => this.resolveThinkingLevelForModel(model),
        authorizeAndSyncAgentModelSelection: async (model) => {
          let selectedModel = model;
          while (true) {
            const auth = await this.resolveAuth(selectedModel);
            if (
              activeTurn.abortController.signal.aborted
              || this.activeTurn !== activeTurn
              || this.agent !== agent
            ) return null;
            if (!auth) {
              throw new Error(`Provider authentication is unavailable for ${selectedModel.provider}.`);
            }

            const latestModel = this.resolveModel();
            if (!latestModel) return null;
            if (
              latestModel.provider !== selectedModel.provider
              || latestModel.id !== selectedModel.id
            ) {
              selectedModel = latestModel;
              continue;
            }
            this.syncAgentModelSelection(selectedModel, agent);
            return selectedModel;
          }
        },
        refreshModelMetadata: () => this.refreshLocalModelMetadataAfterPrompt(agent),
        syncSessionMessages: async (messages) => {
          await this.persistSteeredTurnBeforeSync(activeTurn, messages);
          await this.syncSessionMessagesAfterTurn(
            messages,
            [effectiveTurn, ...activeTurn.steeredTurns],
          );
        },
        onUserMessagePersisted: ({ parentEntryId, userEntryId, leafId }) => {
          this.currentTurnMetadata.userParentEntryId = parentEntryId;
          this.currentTurnMetadata.userMessageId = userEntryId;
          this.leafId = leafId;
        },
      }, effectiveTurn);
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  steer(turn: PreparedChatTurn): boolean {
    const activeTurn = this.activeTurn;
    const agent = this.agent;
    if (
      !activeTurn
      || activeTurn.abortController.signal.aborted
      || !agent?.signal
      || agent.signal.aborted
    ) {
      return false;
    }
    activeTurn.steeredTurns.push(turn);
    const images = toPiImageContent(turn.request.images);
    agent.steer({
      role: 'user',
      // Mirror agent.prompt(text, images): text-only stays a string; attachments use content blocks.
      content: images.length > 0
        ? [{ type: 'text', text: turn.prompt }, ...images]
        : turn.prompt,
      timestamp: Date.now(),
    });
    return true;
  }

  cancel(): void {
    this.activeTurn?.abortController.abort();
    this.agent?.abort();
    this.subagentRunner.abortAllSubagents();
    invalidateCompactionState(this.compactionState);
  }

  resetSession(): void {
    this.invalidatePendingSessionTree();
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
      closeActiveTurnQueue(this.activeTurn);
    }
    this.invalidatePendingSessionTree();
    this.subagentRunner.reset();
    this.subagentRunner.abortAllSubagents();
    invalidateCompactionState(this.compactionState);
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

    await this.ensureSessionTree({ allowSessionCreation: false }, this.sessionGeneration);
    if (!this.sessionTree) {
      return { canRewind: false, error: 'No active session to rewind.' };
    }

    if (!await this.sessionTree.truncateAfter(checkpointId)) {
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
    const sessionFile = this.sessionTree?.getSessionFile()
      ?? this.sessionFile;

    return buildSessionStateUpdates({
      sessionId: this.getSessionId(),
      sessionFile,
      agentState: this.openSessionAgentState,
    });
  }

  async testConnectivity(): Promise<ConnectivityTestResult> {
    const model = this.resolveModel();
    const auth = model ? await this.resolveAuth(model) : undefined;
    return testPiChatConnectivity(this.network.httpClient, model, auth);
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
    const resolveReadMaxChars = (requestedMaxChars?: number) => (
      this.readBudget.reserve(requestedMaxChars)
    );
    if (!vaultPath) {
      return buildPiToolRegistry({
        host: this.plugin,
        vaultPath: '',
        mcpBridge: this.mcpBridge,
        baseToolProvider: this.baseToolProvider,
        mainOnlyToolProvider: this.mainOnlyToolProvider,
        externalContextPaths: this.externalContextPaths,
        subagentQueryRunner: this.subagentRunner,
        resolveReadMaxChars,
        capabilityApproval: this.capabilityApproval,
        contextLayers: this.contextLayersFactory?.('', null),
      });
    }
    return buildPiToolRegistry({
      host: this.plugin,
      vaultPath,
      mcpBridge: this.mcpBridge,
      baseToolProvider: this.baseToolProvider,
      mainOnlyToolProvider: this.mainOnlyToolProvider,
      externalContextPaths: this.externalContextPaths,
      subagentQueryRunner: this.subagentRunner,
      resolveReadMaxChars,
      capabilityApproval: this.capabilityApproval,
      contextLayers: this.contextLayersFactory?.(vaultPath, null),
    });
  }

  private buildSubagentTools(
    resolveReadMaxChars: (requestedMaxChars?: number) => ReadAllowanceReservation,
  ): AgentTool[] {
    const vaultPath = this.getVaultPath();
    // Intentionally uses only baseToolProvider (+ MCP). mainOnlyToolProvider is
    // never requested here so management tools cannot appear in subagent inventory.
    if (!vaultPath || !this.baseToolProvider) {
      return [];
    }
    const providedBaseTools = this.baseToolProvider({
      vaultPath,
      externalContextPaths: this.externalContextPaths,
      resolveReadMaxChars,
      capabilityApproval: this.capabilityApproval,
    });
    const baseTools = providedBaseTools.toolSpecs
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT);
    const mcpTools = this.mcpBridge?.getToolSpecs()
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT) ?? [];
    return [...baseTools, ...mcpTools];
  }

  private async ensureSessionTree(options: PiEnsureReadyOptions | undefined, generation: number): Promise<void> {
    if (generation !== this.sessionGeneration) {
      return;
    }
    if (this.sessionTree) {
      return;
    }
    if (!this.sessionTreeFactory) {
      return;
    }
    if (this.sessionTreeInit && this.sessionTreeInit.generation === generation) {
      await this.sessionTreeInit.promise;
      return;
    }

    const existingFile = this.sessionFile
      ?? getLegacySessionFileFromAgentState(this.openSessionAgentState)
      ?? null;
    if (!existingFile && options?.allowSessionCreation === false) {
      return;
    }

    const initGeneration = generation;
    const promise = this.openOrCreateSessionTree(existingFile)
      .then(async (tree) => {
        // Losing generation: retire a newly created unpublished tree when the
        // factory owns a safe terminal-discard operation.
        if (initGeneration !== this.sessionGeneration) {
          if (!existingFile) await this.sessionTreeFactory?.discardCreated?.(tree);
          return;
        }
        this.sessionTree = tree;
        this.sessionFile = tree.getSessionFile();
        this.leafId = tree.getLeafId();
        this.sessionId = tree.getSessionId();
      })
      .finally(() => {
        if (this.sessionTreeInit?.promise === promise) {
          this.sessionTreeInit = null;
        }
      });

    this.sessionTreeInit = { generation: initGeneration, promise };
    try {
      await promise;
    } catch (error) {
      // Invalidated waiters must not surface factory errors as readiness failures.
      if (initGeneration !== this.sessionGeneration) {
        return;
      }
      throw error;
    }
  }

  private async openOrCreateSessionTree(existingFile: string | null): Promise<PiSessionTree> {
    if (!this.sessionTreeFactory) {
      throw new Error('Session persistence is unavailable.');
    }
    if (existingFile) {
      return this.sessionTreeFactory.open(existingFile);
    }
    return this.sessionTreeFactory.create();
  }

  /**
   * Bump the session generation and drop any published or in-flight tree so a
   * concurrent ensureReady cannot assign state for a superseded binding.
   */
  private invalidatePendingSessionTree(): void {
    this.sessionTree = null;
    this.sessionId = null;
    this.sessionGeneration += 1;
    this.sessionTreeInit = null;
  }

  private invalidateAgentSession(): void {
    invalidateCompactionState(this.compactionState);
    this.agent?.reset();
    this.agent = null;
    this.systemPromptKey = null;
    this.toolRegistryKey = null;
    this.setReady(false);
  }

  private compactionDeps() {
    return {
      plugin: this.plugin,
      sessionTree: this.sessionTree,
      agent: this.agent,
      compactionState: this.compactionState,
      resolveModel: () => this.resolveModel(),
      onLeafIdChanged: (leafId: string | null) => {
        this.leafId = leafId;
      },
      onAssistantMessageId: (entryId: string) => {
        this.currentTurnMetadata.assistantMessageId = entryId;
      },
    };
  }

  private calculateReadMaxCharsForTools(): number {
    const model = this.resolveModel();
    const messages = this.agent?.state.messages ?? [];
    const latestUsage = latestUsageFromMessages(messages, model)
      ?? buildEstimatedUsageInfo(messages, model)
      ?? buildZeroUsageInfoForModel(model);
    return calculateReadToolMaxChars(
      attachContextEnvelope(this.compactionDeps(), latestUsage, undefined, messages),
    );
  }

  private syncSessionMessagesAfterTurn(
    messages: AgentMessage[],
    turns?: PreparedChatTurn | readonly PreparedChatTurn[],
  ): Promise<void> {
    return syncSessionMessagesAfterTurn(
      this.sessionTree,
      messages,
      turns,
      (leafId) => {
        this.leafId = leafId;
      },
      (entryId) => {
        if (entryId) {
          this.currentTurnMetadata.assistantMessageId = entryId;
        }
      },
    );
  }

  private async persistSteeredTurnBeforeSync(activeTurn: ActiveTurn, messages: AgentMessage[]): Promise<void> {
    const turn = activeTurn.steeredTurns[activeTurn.persistedSteeredTurnCount];
    if (!turn || !this.sessionTree) {
      return;
    }
    const containsSteeredUserMessage = messages.some((message) => {
      if (message.role !== 'user') return false;
      const content = typeof message.content === 'string'
        ? message.content
        : extractTextContent(message.content);
      // Pi queues the exact AgentMessage passed to steer(); context transforms apply only
      // to the provider request. Keep this strict so an earlier similar turn cannot match.
      return content === turn.prompt;
    });
    if (!containsSteeredUserMessage) {
      return;
    }
    await this.sessionTree.appendUserTurn(
      turn.persistedContent,
      turn.request.images,
      {
        displayContent: turn.displayContent,
        turnRequest: toChatTurnRequestSnapshot(turn.request),
      },
    );
    activeTurn.persistedSteeredTurnCount += 1;
  }

  private dispatchSubagentChunk(chunk: StreamChunk): void {
    const activeTurn = this.activeTurn;
    const subagentToolId = getSubagentOwnerToolId(chunk);
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
        logger.warn('subagent chunk listener threw', error);
      });
    }
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
      logger.warn(`Failed to refresh ${model.provider} model metadata after first prompt: ${message}`);
    }
    return false;
  }

  /**
   * Resolve a pi-ai Model object from plugin settings.
   *
   * Settings store models as "<provider>/<modelId>".
   */
  private resolveModel(): PiResolvedModel | null {
    return resolvePiModel(this.plugin);
  }

  /**
   * The composer switches models without resetting the session, so the running
   * Agent must follow: keeping the construction-time model made usage/compaction
   * assume the new window while requests still hit the old provider/model.
   */
  private syncAgentModelSelection(model: PiResolvedModel, agent = this.agent): void {
    const current = agent?.state.model;
    if (!agent) {
      return;
    }
    if (current?.provider !== model.provider || current.id !== model.id) {
      agent.state.model = model;
      // Compaction thresholds derive from the model's context window.
      invalidateCompactionState(this.compactionState);
    }
    agent.state.thinkingLevel = this.resolveThinkingLevelForModel(model);
  }

  /**
   * The failed assistant message records the serving provider/model; settings
   * may already point at a different model, so diagnostics resolve from the
   * message first and fall back to the current selection.
   */
  private resolveErrorContext(message: Record<string, unknown>): PiChatErrorContext | null {
    const provider = typeof message.provider === 'string' ? message.provider : '';
    const modelId = typeof message.model === 'string' ? message.model : '';
    const servingModel = provider && modelId
      ? resolvePiModelByKey(`${provider}/${modelId}`)
      : null;
    const model = servingModel ?? this.resolveModel();
    if (!model) {
      return null;
    }
    const messages = this.agent?.state.messages ?? [];
    const usage = latestUsageFromMessages(messages, model)
      ?? buildEstimatedUsageInfo(messages, model);
    return {
      model: `${model.provider}/${model.id}`,
      contextWindow: model.contextWindow ?? 0,
      ...(usage && usage.contextTokens > 0 ? { contextTokens: usage.contextTokens } : {}),
    };
  }

  private async resolveAuth(model: NonNullable<ReturnType<typeof resolvePiModel>>) {
    try {
      return await resolvePiProviderAuth(this.plugin, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to resolve provider auth for ${model.provider}: ${message}`);
      return undefined;
    }
  }

}
