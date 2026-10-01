import type {
  Agent} from '@earendil-works/pi-agent-core';
import {
  type AgentMessage,
  type AgentTool,
} from '@earendil-works/pi-agent-core';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type {
  McpOAuthService,
  McpServerManager,
} from '@pivi/agent/mcp';
import type { McpToolBridge } from '@pivi/agent/mcp';
import type { CapabilityApprovalPort } from '@pivi/agent/ports/capabilityApproval';
import {
  appendExternalContextAvailability,
  buildPiSystemPrompt,
  computePiSystemPromptKey,
  normalizePromptModuleSettings,
  type PromptModuleSettings,
} from '@pivi/agent/prompt';
import type {
  ChatMessage,
  OpenSessionState,
  StreamChunk,
} from '@pivi/agent/runtime';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';
import { prepareChatTurn } from '@pivi/agent/runtime/prepareTurn';
import { RuntimeReadyState } from '@pivi/agent/runtime/runtimeReadyState';
import {
  buildSessionStateUpdates,
  getLegacySessionFileFromAgentState,
} from '@pivi/agent/runtime/sessionStateProjection';
import type {
  ChatRewindResult,
  ChatTurnMetadata,
  ChatTurnRequest,
  ConnectivityTestResult,
  PiEnsureReadyOptions,
  PiTurnOptions,
  PreparedChatTurn,
} from '@pivi/agent/runtime/types';
import {
  type ReadAllowanceReservation,
} from '@pivi/agent/runtime/usage';

import type { PiResolvedModel } from '../models/piModelRegistry';
import { stripCompactCommand } from '../session/piContextCompaction';
import { SessionTreeStore } from '../session/sessionTreeStore';
import {
  buildPiToolRegistry,
  type PiBaseToolProvider,
  type PiMainOnlyToolProvider,
} from '../tools/buildPiToolRegistryCore';
import {
  PiAgentEventAdapter,
  type PiChatErrorContext,
} from './piAgentEventAdapter';
import {
  createPiAuxQueryRunner,
  type PiAuxQueryRunner,
} from './piAuxQueryRunner';
import {
  type ActiveTurn,
  closeActiveTurnQueue,
  createActiveTurn,
} from './piChatRuntimeActiveTurn';
import {
  invalidateCompactionState,
  type PiChatCompactionState,
  syncSessionMessagesAfterTurn,
} from './piChatRuntimeCompaction';
import { testPiChatConnectivity } from './piChatRuntimeConnectivity';
import { PiChatModelResolver } from './piChatRuntimeModels';
import {
  authorizeModelSelection,
  describeAgentInitFailure,
  describeMissingProviderAuth,
  replaceLeadingSystemPrompt,
  resolveChatErrorContext,
  streamManualCompaction,
} from './piChatRuntimeSupport';
import { buildSubagentAgentTools, createChatAgent, createMcpToolBridge, steerActiveTurn } from './piChatRuntimeTools';
import { streamPiChatTurn } from './piChatRuntimeTurn';
import {
  persistSteeredTurnBeforeSync,
  routeSubagentChunk,
} from './piChatRuntimeTurnSync';
import {
  type PiChatRuntimeNetwork,
  type PiChatRuntimeProviderOverride,
} from './piChatRuntimeTypes';
import { createPiReadBudget } from './piReadBudget';
import type { PiRuntimeHost } from './piRuntimeHost';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';
export {
  type PiChatRuntimeNetwork,
  type PiChatRuntimeProviderOverride,
} from './piChatRuntimeTypes';

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
  private readonly mcpBridge: McpToolBridge | null;
  private toolRegistryKey: string | null = null;
  private sessionTree: SessionTreeStore | null = null;
  private sessionFile: string | null = null;
  private leafId: string | null = null;
  private readonly compactionState: PiChatCompactionState = {
    autoCompactionInFlight: false,
    failedAutoAttempts: new Map(),
    foregroundController: null,
    generation: 0,
    prefire: null,
  };
  private readonly subagentRunner: PiAuxQueryRunner;
  private readonly readBudget = createPiReadBudget(
    () => this.models.readMaxCharsForTools(),
  );
  private readonly subagentChunkListeners = new Set<(chunk: StreamChunk) => void | Promise<void>>();
  private readonly readyState = new RuntimeReadyState((error) => {
    logger.warn('ready listener threw', error);
  });
  private openSessionAgentState: Record<string, unknown> | undefined;
  private externalContextPaths: string[] = [];
  private readonly models: PiChatModelResolver;
  private capabilityApproval: CapabilityApprovalPort | null = null;

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly network: PiChatRuntimeNetwork,
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
    private readonly providerOverride: PiChatRuntimeProviderOverride | null = null,
  ) {
    this.models = new PiChatModelResolver(plugin, providerOverride, (message) => { logger.warn(message); });
    this.capabilityApproval = capabilityApproval;
    this.mcpManager = mcpManager;
    this.mcpBridge = createMcpToolBridge(mcpManager, mcpOAuth, network);
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
    this.syncAgentTools();
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
    const model = this.models.resolveModel();
    if (!model) {
      logger.error('Could not resolve Pi model from settings');
      this.setReady(false);
      return false;
    }

    const auth = await this.models.resolveAuth(model);
    if (!auth) {
      logger.error(describeMissingProviderAuth(model.provider));
      this.setReady(false);
      return false;
    }

    this.ensureSessionTree(options);

    // Prompt-only changes hot-update; force rebuilds the agent (model/env paths).
    if (this.agent && options?.force !== true) {
      this.syncAgentModelSelection(model);
      this.syncAgentTools();
      return true;
    }
    if (this.agent && options?.force === true) {
      invalidateCompactionState(this.compactionState);
    }

    const registry = this.buildToolRegistry();
    const composition = this.readPromptComposition();
    const systemPrompt = buildPiSystemPrompt(
      this.getVaultPath() ?? undefined,
      this.plugin.settings.userName,
      registry,
      composition,
    );
    const sessionMessages = this.sessionTree?.loadAgentMessages() ?? [];

    this.agent = createChatAgent({
      model,
      systemPrompt,
      tools: registry.tools,
      messages: sessionMessages,
      thinkingLevel: this.models.resolveThinkingLevel(model),
      streamFn: this.providerOverride?.streamFn,
      sessionId: this.sessionId ?? undefined,
    });

    this.systemPromptKey = computePiSystemPromptKey(
      this.getVaultPath() ?? undefined,
      this.plugin.settings.userName,
      registry,
      composition,
    );
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
      yield { type: 'error', content: describeAgentInitFailure(this.models.resolveModel()) };
      yield { type: 'done' };
      return;
    }

    if (!this.agent) {
      yield { type: 'error', content: 'Pi Agent is not ready.' };
      yield { type: 'done' };
      return;
    }

    if (turn.isCompact) {
      yield* streamManualCompaction(() => this.compactionDeps(), stripCompactCommand(turn.request.text));
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
        resolveModel: () => this.models.resolveModel(),
        resolveThinkingLevel: (model) => this.models.resolveThinkingLevel(model),
        authorizeAndSyncAgentModelSelection: (model) => authorizeModelSelection(model, {
          resolveAuth: (candidate) => this.models.resolveAuth(candidate),
          resolveModel: () => this.models.resolveModel(),
          isStale: () => activeTurn.abortController.signal.aborted
            || this.activeTurn !== activeTurn
            || this.agent !== agent,
          sync: (selected) => { this.syncAgentModelSelection(selected, agent); },
        }),
        refreshModelMetadata: () => this.models.refreshLocalMetadataAfterPrompt(agent),
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
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  steer(turn: PreparedChatTurn): boolean {
    return steerActiveTurn(this.activeTurn, this.agent, turn);
  }

  cancel(): void {
    this.activeTurn?.abortController.abort();
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
    this.subagentRunner.reset();
    this.subagentRunner.abortAllSubagents();
    invalidateCompactionState(this.compactionState);
    this.agent?.reset();
    this.agent = null;
    void this.mcpBridge?.dispose()?.catch((error: unknown) => {
      logger.warn('MCP bridge dispose failed', error);
    });
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
    const model = this.models.resolveModel();
    const auth = model ? await this.models.resolveAuth(model) : undefined;
    return testPiChatConnectivity(this.network.httpClient, model, auth);
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
    return buildPiToolRegistry({
      host: this.plugin,
      vaultPath: this.getVaultPath() || '',
      mcpBridge: this.mcpBridge,
      baseToolProvider: this.baseToolProvider,
      mainOnlyToolProvider: this.mainOnlyToolProvider,
      externalContextPaths: this.externalContextPaths,
      subagentQueryRunner: this.subagentRunner,
      resolveReadMaxChars: (requestedMaxChars?: number) => this.readBudget.reserve(requestedMaxChars),
      capabilityApproval: this.capabilityApproval,
    });
  }

  private buildSubagentTools(
    resolveReadMaxChars: (requestedMaxChars?: number) => ReadAllowanceReservation,
  ): AgentTool[] {
    return buildSubagentAgentTools({
      vaultPath: this.getVaultPath(),
      baseToolProvider: this.baseToolProvider,
      mcpBridge: this.mcpBridge,
      externalContextPaths: this.externalContextPaths,
      capabilityApproval: this.capabilityApproval,
      resolveReadMaxChars,
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
      this.adoptSessionTree(SessionTreeStore.open(vaultPath, existingFile));
      return;
    }
    if (options?.allowSessionCreation === false) {
      return;
    }
    this.adoptSessionTree(SessionTreeStore.create(vaultPath));
  }

  private adoptSessionTree(tree: SessionTreeStore): void {
    this.sessionTree = tree;
    this.sessionFile = tree.getVaultRelativeSessionFile();
    this.leafId = tree.getLeafId();
    this.sessionId = tree.getSessionId();
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
      resolveModel: () => this.models.resolveModel(),
      onLeafIdChanged: (leafId: string | null) => {
        this.leafId = leafId;
      },
      onAssistantMessageId: (entryId: string) => {
        this.currentTurnMetadata.assistantMessageId = entryId;
      },
    };
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
    persistSteeredTurnBeforeSync(this.sessionTree, activeTurn, messages);
  }

  private dispatchSubagentChunk(chunk: StreamChunk): void {
    routeSubagentChunk(this.activeTurn, this.subagentChunkListeners, chunk, (error) => {
      logger.warn('subagent chunk listener threw', error);
    });
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

  private readPromptComposition(): PromptModuleSettings {
    return normalizePromptModuleSettings(
      this.plugin.settings.promptModules,
      this.plugin.settings.customPromptModules,
    );
  }

  private applySystemPrompt(registry?: ReturnType<typeof buildPiToolRegistry>): void {
    const resolvedRegistry = registry ?? this.buildToolRegistry();
    const composition = this.readPromptComposition();
    const nextKey = computePiSystemPromptKey(
      this.getVaultPath() ?? undefined,
      this.plugin.settings.userName,
      resolvedRegistry,
      composition,
    );
    if (this.systemPromptKey === nextKey) {
      return;
    }

    if (this.agent) {
      const nextPrompt = buildPiSystemPrompt(
        this.getVaultPath() ?? undefined,
        this.plugin.settings.userName,
        resolvedRegistry,
        composition,
      );
      replaceLeadingSystemPrompt(this.agent, nextPrompt);
    }
    this.systemPromptKey = nextKey;
  }

  private setReady(ready: boolean): void {
    this.readyState.setReady(ready);
  }

  private applyThinkingLevelFromSettings(): void {
    if (!this.agent) {
      return;
    }
    const model = this.models.resolveModel();
    if (!model) {
      return;
    }
    this.agent.state.thinkingLevel = this.models.resolveThinkingLevel(model);
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
    agent.state.thinkingLevel = this.models.resolveThinkingLevel(model);
  }

  /**
   * The failed assistant message records the serving provider/model; settings
   * may already point at a different model, so diagnostics resolve from the
   * message first and fall back to the current selection.
   */
  private resolveErrorContext(message: Record<string, unknown>): PiChatErrorContext | null {
    return resolveChatErrorContext(message, {
      customContextLimits: this.plugin.settings.customContextLimits,
      resolveModel: () => this.models.resolveModel(),
      messages: this.agent?.state.messages ?? [],
      compactionDeps: this.compactionDeps(),
    });
  }
}
