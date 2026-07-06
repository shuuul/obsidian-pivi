import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import { getProviderAuthFailureHint } from '@pivi/pivi-agent-core/auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import { buildPiToolRegistry, type PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import { PiAgentEventAdapter } from '@pivi/pivi-agent-core/engine/pi/piAgentEventAdapter';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { createPiAuxQueryRunner } from '@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner';
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

type SessionEntry = ReturnType<SessionTreeStore['getEntries']>[number];

const COMPACTION_SYSTEM_PROMPT = `You summarize a long agent coding session for future continuation.
Preserve durable facts, current user goal, decisions made, files/notes/tools touched, important tool results, unresolved questions, and next steps.
Do not add new facts. Be concise but specific enough that the next assistant can continue safely.`;

const COMPACTION_SUMMARY_PREFIX = 'The earlier session history was compacted. Use this summary as authoritative context for the omitted earlier turns:';
const DEFAULT_COMPACTION_CONTEXT_WINDOW = 200_000;

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => {
    if (!isRecord(part)) return '';
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    if (part.type === 'thinking' && typeof part.thinking === 'string') return `[thinking]\n${part.thinking}`;
    if (part.type === 'toolCall') return `[tool call: ${String(part.name ?? 'tool')}] ${JSON.stringify(part.arguments ?? {})}`;
    return '';
  }).filter(Boolean).join('\n');
}

function textFromAgentMessage(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  return textFromContent(record.content);
}

function isMessageEntry(entry: SessionEntry): entry is SessionEntry & { type: 'message'; message: AgentMessage } {
  return entry.type === 'message' && 'message' in entry;
}

function estimateEntryTokens(entry: SessionEntry): number {
  if (!isMessageEntry(entry)) {
    return 0;
  }
  return estimateTextTokens(textFromAgentMessage(entry.message));
}

function roleForSummary(message: AgentMessage): string {
  const role = (message as unknown as Record<string, unknown>).role;
  return typeof role === 'string' ? role : 'message';
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, Math.floor(maxChars * 0.65));
  const tail = text.slice(text.length - Math.floor(maxChars * 0.25));
  return `${head}\n...[truncated ${text.length - head.length - tail.length} chars]...\n${tail}`;
}

function stripCompactCommand(text: string): string | undefined {
  const instructions = text.trim().replace(/^\/compact(?:\s|$)/i, '').trim();
  return instructions || undefined;
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
  private autoCompactionInFlight = false;
  private lastAutoCompactionAttemptLeafId: string | null = null;
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
        return;
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
    ).then(async () => {
      try {
        this.syncSessionMessagesAfterTurn(emittedMessages.length > 0 ? emittedMessages : agent.state.messages);
      } catch (error) {
        console.warn('Pivi: failed to sync final agent state after turn', error);
      }
      const usage = this.latestUsageFromMessages(emittedMessages.length > 0 ? emittedMessages : agent.state.messages);
      if (usage && this.shouldAutoCompact(usage)) {
        activeTurn.queue.push({ type: 'context_compacting' });
        try {
          const compacted = await this.compactCurrentSession('threshold');
          if (compacted) {
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
      activeTurn.queue.push({ type: 'done' });
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

  private latestUsageFromMessages(messages: AgentMessage[]): UsageInfo | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const usage = this.buildUsageInfo(messages[i]);
      if (usage) {
        return usage;
      }
    }
    return null;
  }

  private shouldAutoCompact(providerUsage: UsageInfo): boolean {
    if (!this.plugin.settings.enableAutoCompact || this.autoCompactionInFlight || !this.sessionTree) {
      return false;
    }

    const leafId = this.sessionTree.getLeafId();
    if (!leafId || this.lastAutoCompactionAttemptLeafId === leafId) {
      return false;
    }

    const contextWindow = providerUsage.contextWindow > 0
      ? providerUsage.contextWindow
      : DEFAULT_COMPACTION_CONTEXT_WINDOW;
    const thresholdRatio = Math.min(0.95, Math.max(0.5, this.plugin.settings.autoCompactThresholdRatio ?? 0.9));
    const thresholdTokens = Math.floor(contextWindow * thresholdRatio);
    const storedTokens = this.estimateStoredConversationTokens();
    const decisionTokens = Math.max(providerUsage.contextTokens, storedTokens);
    return decisionTokens > thresholdTokens;
  }

  private estimateStoredConversationTokens(): number {
    if (!this.sessionTree) {
      return 0;
    }
    return this.sessionTree.getVisiblePrefix().reduce((total, entry) => total + estimateEntryTokens(entry), 0);
  }

  private selectCompactionCutPoint(entries: SessionEntry[]): {
    firstKeptEntryId: string;
    prefixEntries: SessionEntry[];
    tokensBefore: number;
  } | null {
    const messageEntries = entries.filter(isMessageEntry);
    if (messageEntries.length < 4) {
      return null;
    }

    const keepRecentTokens = Math.min(
      200_000,
      Math.max(1_000, this.plugin.settings.autoCompactKeepRecentTokens ?? 20_000),
    );
    let keptTokens = 0;
    let firstKeptIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!isMessageEntry(entry)) {
        continue;
      }
      keptTokens += estimateEntryTokens(entry);
      firstKeptIndex = i;
      if (keptTokens >= keepRecentTokens) {
        break;
      }
    }

    if (firstKeptIndex <= 0) {
      return null;
    }

    const firstKept = entries[firstKeptIndex];
    if (!isMessageEntry(firstKept)) {
      return null;
    }

    const prefixEntries = entries.slice(0, firstKeptIndex).filter(isMessageEntry);
    const tokensBefore = entries.reduce((total, entry) => total + estimateEntryTokens(entry), 0);
    if (prefixEntries.length < 2) {
      return null;
    }

    return {
      firstKeptEntryId: firstKept.id,
      prefixEntries,
      tokensBefore,
    };
  }

  private buildCompactionPrompt(prefixEntries: SessionEntry[], instructions?: string): string {
    const lines = prefixEntries.map((entry, index) => {
      if (!isMessageEntry(entry)) {
        return '';
      }
      const role = roleForSummary(entry.message);
      const content = truncateForSummary(textFromAgentMessage(entry.message), 4_000);
      return `## ${index + 1}. ${role}\n${content}`;
    }).filter(Boolean);

    const customInstructions = instructions
      ? `\n\nUser focus for this compaction:\n${instructions}`
      : '';
    const history = truncateForSummary(lines.join('\n\n'), 120_000);
    return `Summarize the following earlier session history for future continuation.${customInstructions}\n\n${history}`;
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
      this.lastAutoCompactionAttemptLeafId = attemptLeafId;
    }

    const entries = this.sessionTree.getVisiblePrefix();
    const cutPoint = this.selectCompactionCutPoint(entries);
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
        }, this.buildCompactionPrompt(cutPoint.prefixEntries, instructions));
        const summary = `${COMPACTION_SUMMARY_PREFIX}\n\n${summaryText.trim()}`;
        const compactionId = this.sessionTree.appendCompaction(
          summary,
          cutPoint.firstKeptEntryId,
          cutPoint.tokensBefore,
        );
        this.leafId = this.sessionTree.getLeafId();
        this.currentTurnMetadata.assistantMessageId = compactionId;
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
