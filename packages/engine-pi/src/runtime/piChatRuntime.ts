import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import { getProviderAuthFailureHint } from '@pivi/agent/auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '@pivi/agent/auth/providerEnvVars';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { McpOAuthService, McpServerManager } from '@pivi/agent/mcp';
import { McpToolBridge } from '@pivi/agent/mcp';
import type { McpProcessEnv, McpTransportFetch } from '@pivi/agent/mcp/ports';
import type { HttpClient, SyncSecretStore } from '@pivi/agent/ports';
import type { CapabilityApprovalPort } from '@pivi/agent/ports/capabilityApproval';
import {
  appendExternalContextAvailability,
  buildPiSystemPrompt,
  computePiSystemPromptKey,
  normalizePromptModuleSettings,
  type PromptModuleSettings,
} from '@pivi/agent/prompt';
import type { ChatMessage, OpenSessionState, StreamChunk } from '@pivi/agent/runtime';
import { getContextCalibration } from '@pivi/agent/runtime/contextAccounting';
import { extractTextContent } from '@pivi/agent/runtime/messageContent';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';
import { prepareChatTurn } from '@pivi/agent/runtime/prepareTurn';
import { toChatTurnRequestSnapshot } from '@pivi/agent/runtime/queuedTurn';
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
import { calculateReadToolMaxChars, type ReadAllowanceReservation } from '@pivi/agent/runtime/usage';
import { TOOL_SPAWN_AGENT } from '@pivi/agent/tools';

import {
  refreshCustomPiProviderModels,
  streamPiAiModelsSimple,
} from '../models/piAiModels';
import { resolvePiModel, resolvePiModelByKey, resolvePiProviderAuth } from '../models/piModelEnv';
import type { PiResolvedModel } from '../models/piModelRegistry';
import { resolvePiThinkingLevelForModel } from '../models/piThinkingLevels';
import { sanitizeAgentMessagesForLlm } from '../session/agentMessageHistory';
import { stripCompactCommand } from '../session/piContextCompaction';
import { SessionTreeStore } from '../session/sessionTreeStore';
import {
  buildPiToolRegistry,
  type PiBaseToolProvider,
  type PiMainOnlyToolProvider,
} from '../tools/buildPiToolRegistryCore';
import { toPiAgentTool } from '../tools/piToolAdapter';
import { PiAgentEventAdapter, type PiChatErrorContext } from './piAgentEventAdapter';
import { createPiAuxQueryRunner, type PiAuxQueryRunner } from './piAuxQueryRunner';
import {
  type ActiveTurn,
  closeActiveTurnQueue,
  createActiveTurn,
  getSubagentOwnerToolId,
} from './piChatRuntimeActiveTurn';
import {
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
  latestUsageFromMessages,
} from './piChatRuntimeUsage';
import { toPiImageContent } from './piImageContent';
import { createPiReadBudget } from './piReadBudget';
import type { PiRuntimeHost } from './piRuntimeHost';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';


export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
  mcpSecretStorage?: SyncSecretStore;
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
  ) {
    this.capabilityApproval = capabilityApproval;
    this.mcpManager = mcpManager;
    this.mcpBridge = mcpManager
      ? new McpToolBridge(
        mcpManager,
        mcpOAuth,
        network.mcpFetch,
        network.mcpProcessEnv,
        network.mcpSecretStorage,
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
    const key = model ? `${model.provider}/${model.id}` : '';
    return calculateReadToolMaxChars(getContextCalibration(key));
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
      this.agent.state.systemPrompt = buildPiSystemPrompt(
        this.getVaultPath() ?? undefined,
        this.plugin.settings.userName,
        resolvedRegistry,
        composition,
      );
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
      ? resolvePiModelByKey(`${provider}/${modelId}`, this.plugin.settings.customContextLimits)
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
