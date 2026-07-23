import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';

import { getProviderAuthFailureHint } from '../../auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import type {
  ChatMessage,
  OpenSessionState,
  StreamChunk,
} from '../../foundation';
import { PluginLogger } from '../../foundation/pluginLogger';
import { calculateReadToolMaxChars } from '../../foundation/usage';
import type { McpOAuthService, McpServerManager } from '../../mcp';
import { PiMcpBridge } from '../../mcp';
import type { McpProcessEnv, McpTransportFetch } from '../../mcp/ports';
import type { HttpClient, SyncSecretStore } from '../../ports';
import {
  appendExternalContextAvailability,
  buildPiSystemPrompt,
  computePiSystemPromptKey,
} from '../../prompt';
import {
  HighRiskApprovalController,
  type HighRiskApprovalPresenter,
  type HighRiskAuditSink,
  runWithHighRiskContext,
  wrapToolSpecsWithHighRiskGate,
} from '../../runtime/highRisk';
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
import { buildPiToolRegistry, type PiBaseToolProvider } from './buildPiToolRegistryCore';
import { PiAgentEventAdapter } from './piAgentEventAdapter';
import {
  piAiModels,
  refreshCustomPiProviderModels,
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
import { resolvePiModel, resolvePiProviderAuth } from './piModelEnv';
import { createPiReadBudget } from './piReadBudget';
import type { PiRuntimeHost } from './piRuntimeHost';
import { resolvePiThinkingLevelForModel } from './piThinkingLevels';
import { toPiAgentTool } from './piToolAdapter';
import { sanitizeAgentMessagesForLlm } from './session/agentMessageHistory';
import { stripCompactCommand } from './session/piContextCompaction';
import { SessionTreeStore } from './session/sessionTreeStore';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';


export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
  mcpSecretStorage?: SyncSecretStore;
}

export interface PiChatRuntimeHighRiskOptions {
  presenter?: HighRiskApprovalPresenter;
  audit?: HighRiskAuditSink;
  classificationContext?: {
    pathExists?: (vaultRelativePath: string) => boolean | Promise<boolean>;
    folderChildCount?: (vaultRelativePath: string) => number | Promise<number | undefined> | undefined;
  };
  /** Optional writer for oversized MCP result artifacts under `.pivi/artifacts/mcp/`. */
  writeMcpArtifact?: (vaultRelativePath: string, content: string) => Promise<void>;
}

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
  private readonly eventAdapter = new PiAgentEventAdapter();
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly mcpManager: McpServerManager | null;
  private readonly mcpBridge: PiMcpBridge | null;
  private toolRegistryKey: string | null = null;
  private sessionTree: SessionTreeStore | null = null;
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
  private readonly highRisk: HighRiskApprovalController;
  private turnSequence = 0;

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly network: PiChatRuntimeNetwork,
    mcpManager: McpServerManager | null = null,
    mcpOAuth: McpOAuthService | null = null,
    private readonly baseToolProvider: PiBaseToolProvider | null = null,
    private readonly subagentConcurrencyLimiter?: SubagentConcurrencyLimiter,
    private readonly highRiskOptions: PiChatRuntimeHighRiskOptions = {},
  ) {
    this.highRisk = new HighRiskApprovalController({
      presenter: highRiskOptions.presenter,
      audit: highRiskOptions.audit,
    });
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager
      ? new PiMcpBridge(
        mcpManager,
        mcpOAuth,
        network.mcpFetch,
        network.mcpProcessEnv,
        network.mcpSecretStorage,
        this.getVaultPath() ?? undefined,
        this.highRisk,
        highRiskOptions.writeMcpArtifact
          ? async ({ vaultRelativePath, content }) => {
            await highRiskOptions.writeMcpArtifact?.(vaultRelativePath, content);
          }
          : null,
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
    if (prevSessionFile !== sessionFile) {
      this.highRisk.invalidate('invalidated');
    }
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
    } else if (prevSessionFile !== this.sessionFile) {
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
    const model = this.resolveModel();
    if (!model) {
      logger.error('Could not resolve Pi model from settings');
      this.setReady(false);
      return false;
    }

    const auth = await this.resolveAuth(model);
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

    this.ensureSessionTree(options);

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.syncAgentTools();
      return true;
    }
    if (this.agent && options?.force === true) {
      invalidateCompactionState(this.compactionState);
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
      steeringMode: 'one-at-a-time',
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
    this.turnSequence += 1;
    const sessionKey = this.sessionFile ?? this.sessionId ?? 'anonymous';
    this.highRisk.beginTurn(sessionKey, `turn-${this.turnSequence}`);

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
        refreshModelMetadata: () => this.refreshLocalModelMetadataAfterPrompt(agent),
        syncSessionMessages: (messages) => {
          this.persistSteeredTurnBeforeSync(activeTurn, messages);
          this.syncSessionMessagesAfterTurn(
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
      this.highRisk.endTurn();
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
    this.highRisk.invalidate('cancelled');
    this.agent?.abort();
    this.subagentRunner.abortAllSubagents();
    invalidateCompactionState(this.compactionState);
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
      closeActiveTurnQueue(this.activeTurn);
    }
    this.highRisk.dispose();
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
    const wrapBaseToolSpecs = (specs: ReturnType<NonNullable<PiBaseToolProvider>>['toolSpecs']) => (
      wrapToolSpecsWithHighRiskGate(specs, {
        controller: this.highRisk,
        classificationContext: this.highRiskOptions.classificationContext,
      })
    );
    if (!vaultPath) {
      return buildPiToolRegistry({
        host: this.plugin,
        vaultPath: '',
        mcpBridge: this.mcpBridge,
        baseToolProvider: this.baseToolProvider,
        externalContextPaths: this.externalContextPaths,
        subagentQueryRunner: this.subagentRunner,
        resolveReadMaxChars,
        wrapBaseToolSpecs,
      });
    }
    return buildPiToolRegistry({
      host: this.plugin,
      vaultPath,
      mcpBridge: this.mcpBridge,
      baseToolProvider: this.baseToolProvider,
      externalContextPaths: this.externalContextPaths,
      subagentQueryRunner: this.subagentRunner,
      resolveReadMaxChars,
      wrapBaseToolSpecs,
    });
  }

  private buildSubagentTools(
    resolveReadMaxChars: (requestedMaxChars?: number) => number,
  ): AgentTool[] {
    const vaultPath = this.getVaultPath();
    if (!vaultPath || !this.baseToolProvider) {
      return [];
    }
    const providedBaseTools = this.baseToolProvider({
      vaultPath,
      externalContextPaths: this.externalContextPaths,
      resolveReadMaxChars,
    });
    const childController = new HighRiskApprovalController();
    childController.setMode('inherit-only');
    const sessionKey = this.sessionFile ?? this.sessionId ?? 'anonymous';
    childController.beginTurn(sessionKey, `subagent-${Date.now()}`);
    childController.setParentGrants(this.highRisk.snapshotGrants());
    const gatedSpecs = wrapToolSpecsWithHighRiskGate(providedBaseTools.toolSpecs, {
      controller: childController,
      classificationContext: this.highRiskOptions.classificationContext,
    });
    const baseTools = gatedSpecs
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT);
    const mcpTools = this.mcpBridge?.getToolSpecs()
      .map(toPiAgentTool)
      .filter((tool) => tool.name !== TOOL_SPAWN_AGENT) ?? [];
    const context = { mode: 'inherit-only' as const, controller: childController };
    return [...baseTools, ...mcpTools].map((tool) => ({
      ...tool,
      execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => (
        runWithHighRiskContext(context, () => tool.execute(toolCallId, params, signal))
      ),
    }));
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
  ): void {
    syncSessionMessagesAfterTurn(
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

  private persistSteeredTurnBeforeSync(activeTurn: ActiveTurn, messages: AgentMessage[]): void {
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
    const targetEntryId = this.sessionTree.appendUserMessage(
      turn.persistedContent,
      turn.request.images,
    );
    this.sessionTree.appendMessageUi({
      targetEntryId,
      displayContent: turn.displayContent,
      turnRequest: toChatTurnRequestSnapshot(turn.request),
    });
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
  private resolveModel(): ReturnType<typeof resolvePiModel> {
    return resolvePiModel(this.plugin);
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
