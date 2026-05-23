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
import { getVaultPath } from '../../../utils/path';
import { PI_PROVIDER_CAPABILITIES } from '../capabilities';
import {
  PiClientConnection,
  PiJsonRpcTransport,
  type PiSessionNotification,
  PiSessionUpdateNormalizer,
  PiSubprocess,
} from '../protocol';
import { getPiProviderSettings } from '../settings';

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
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
  readonly providerId = 'pi' as const;

  private activeTurn: ActiveTurn | null = null;
  private connection: PiClientConnection | null = null;
  private process: PiSubprocess | null = null;
  private transport: PiJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;
  private sessionId: string | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly sessionUpdateNormalizer = new PiSessionUpdateNormalizer();
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

  setResumeCheckpoint(checkpointId: string | undefined): void {}

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

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('pi') ?? 'pi';

    const shouldRestart = !this.process || !this.transport || !this.connection || !this.process.isAlive() || this.transport.isClosed || options?.force === true;

    if (shouldRestart) {
      await this.shutdownProcess();
      await this.startProcess({
        command: resolvedCliPath,
        cwd,
      });
    }

    if (!this.sessionId) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
      await this.createSession(cwd);
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      yield { type: 'error', content: 'Failed to start Pi Coding Agent. Check CLI installation.' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection || !this.sessionId) {
      yield { type: 'error', content: 'Pi runtime session is not ready.' };
      yield { type: 'done' };
      return;
    }

    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      sessionId: this.sessionId,
    };
    this.currentTurnMetadata = {};
    this.sessionUpdateNormalizer.reset();

    const activeTurn = this.activeTurn;

    const promptPromise = this.connection.prompt({
      prompt: [{ type: 'text', text: turn.prompt }],
      sessionId: this.sessionId,
    }).then((response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
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
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  resetSession(): void {
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
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
    void this.shutdownProcess();
  }

  async rewind(userMessageId: string, assistantMessageId: string, mode?: ChatRewindMode): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {}
  setApprovalDismisser(dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {}
  setSubagentHookProvider(getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return {
      updates: {
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? conversation?.sessionId ?? null;
  }

  private async startProcess(params: { command: string; cwd: string }): Promise<void> {
    const piSettings = getPiProviderSettings(this.plugin.settings);
    const parsedEnv = parseEnvironmentVariables(piSettings.environmentVariables);
    const parsedSharedEnv = parseEnvironmentVariables(this.plugin.settings.sharedEnvironmentVariables);

    const processEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...parsedSharedEnv,
      ...parsedEnv,
    };

    let command = params.command;
    const args: string[] = [];

    if (command.endsWith('.js')) {
      command = process.execPath;
      processEnv.ELECTRON_RUN_AS_NODE = '1';
      args.push(params.command);
    }

    args.push('--mode', 'rpc');
    const rawModel = this.plugin.settings.model;
    if (rawModel && rawModel !== 'pi:pi-default') {
      const actualModel = rawModel.startsWith('pi:') ? rawModel.substring(3) : rawModel;
      args.push('--model', actualModel);
    }

    this.process = new PiSubprocess({
      args,
      command,
      cwd: params.cwd,
      env: processEnv,
    });
    this.process.start();

    this.transport = new PiJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });

    const transport = this.transport;
    this.unregisterTransportClose = transport.onClose(() => {
      if (this.transport === transport) {
        this.setReady(false);
      }
    });

    this.connection = new PiClientConnection({
      clientInfo: {
        name: 'obsius2',
        version: this.plugin.manifest?.version ?? '0.1.0',
      },
      delegate: {
        onSessionNotification: (notification) => this.handleSessionNotification(notification),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
    this.setReady(true);
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.activeTurn?.queue.close();
    this.activeTurn = null;

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
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

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }
    try {
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.sessionId = response.sessionId;
      return response.sessionId;
    } catch (error) {
      console.error('Failed to create Pi session:', error);
      return null;
    }
  }

  private handleSessionNotification(notification: PiSessionNotification): void {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk': {
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        break;
      }
      default:
        break;
    }
  }
}
