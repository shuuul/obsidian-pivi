import { Agent } from '@earendil-works/pi-agent-core';
import * as piAi from '@earendil-works/pi-ai';

import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
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
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
} from '../../../core/types';
import type ObsiusPlugin from '../../../main';
import { parseEnvironmentVariables } from '../../../utils/env';
import { PI_PROVIDER_CAPABILITIES } from '../capabilities';
import { getPiProviderSettings, isValidModelKey } from '../settings';
import { PiAgentEventAdapter } from './PiAgentEventAdapter';

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

// Fallback model when no model is configured
const PI_FALLBACK_MODEL_KEY = 'anthropic/claude-sonnet-4-20250514';

export class PiChatRuntime implements ChatRuntime {
  readonly providerId = 'pi' as const;

  private activeTurn: ActiveTurn | null = null;
  private agent: Agent | null = null;
  private sessionId: string | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly eventAdapter = new PiAgentEventAdapter();
  private currentTurnMetadata: ChatTurnMetadata = {};

  constructor(private readonly plugin: ObsiusPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return PI_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: request.text,
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null,
  ): void {
    const nextSessionId = conversation?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.sessionId = nextSessionId;
    }
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getPiProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    // Re-create agent when forced or when model/env changed
    if (this.agent && options?.force !== true) {
      return true;
    }

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

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt: '',
        tools: [],
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

    this.setReady(true);
    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      const settings = getPiProviderSettings(this.plugin.settings);
      const model = this.resolveModel();
      const providerHint = model
        ? `Provider: ${model.provider}. Expected env var: ${this.getExpectedApiKeyVar(model.provider as string)}`
        : 'Check your model selection in settings.';
      const enabledHint = settings.enabled ? '' : ' Pi agent is disabled — enable it in settings.';
      yield { type: 'error', content: `Failed to initialize Pi Agent.${enabledHint} ${providerHint}` };
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

    // Subscribe to agent events and push StreamChunks into the queue
    const unsubscribe = agent.subscribe((event) => {
      const chunks = this.eventAdapter.adapt(event);
      for (const chunk of chunks) {
        activeTurn.queue.push(chunk);
      }
    });

    const promptPromise = agent.prompt(turn.prompt).then(() => {
      // agent_end is handled by the adapter; just ensure the queue closes
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
    this.agent?.reset();
    this.sessionId = null;
    this.agent = null;
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
    this.setReady(false);
  }

  async rewind(_userMessageId: string, _assistantMessageId: string, _mode?: ChatRewindMode): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
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
   * Settings store models as "pi:<provider>/<modelId>".
   */
  private resolveModel(): any | null {
    const rawModel = this.plugin.settings.model;
    const modelKey = rawModel?.startsWith('pi:') ? rawModel.substring(3) : rawModel;

    if (modelKey && isValidModelKey(modelKey)) {
      const resolved = this.getModelByKey(modelKey);
      if (resolved) return resolved;
    }

    // Fallback to first visible model from settings
    const piSettings = getPiProviderSettings(this.plugin.settings);
    for (const visibleKey of piSettings.visibleModels) {
      const resolved = this.getModelByKey(visibleKey);
      if (resolved) return resolved;
    }

    return this.getModelByKey(PI_FALLBACK_MODEL_KEY);
  }

  private getModelByKey(key: string): any | null {
    try {
      const slashIndex = key.indexOf('/');
      if (slashIndex <= 0) return null;
      const provider = key.substring(0, slashIndex);
      const modelId = key.substring(slashIndex + 1);
      // piAi.getModel requires KnownProvider; cast since provider comes from user settings
      return (piAi.getModel as any)(provider, modelId);
    } catch {
      return null;
    }
  }

  /**
   * Resolve API key for a given provider from environment variables in settings.
   */
  private resolveApiKey(provider: string): string | undefined {
    const piSettings = getPiProviderSettings(this.plugin.settings);
    const parsedEnv = parseEnvironmentVariables(piSettings.environmentVariables);
    const parsedSharedEnv = parseEnvironmentVariables(this.plugin.settings.sharedEnvironmentVariables);

    // Provider-specific key patterns
    const keyMap: Record<string, string[]> = {
      anthropic: ['ANTHROPIC_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      'google-vertex': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY'],
    };

    const envKeys = keyMap[provider] ?? [`${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`];

    // Check provider env first, then shared, then process.env
    for (const key of envKeys) {
      const value = parsedEnv[key] ?? parsedSharedEnv[key] ?? process.env[key];
      if (value) return value;
    }

    return undefined;
  }

  private getExpectedApiKeyVar(provider: string): string {
    const keyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GEMINI_API_KEY',
      'google-vertex': 'GEMINI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    };
    return keyMap[provider] ?? `${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`;
  }
}
