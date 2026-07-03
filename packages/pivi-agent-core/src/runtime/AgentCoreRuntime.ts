import type { AgentEngineSessionRef, AgentEngineTurnOptions } from '../engine';
import type { ChatMessage, StreamChunk } from '../foundation';
import type { SessionRef, StoreSessionInfo } from '../session';
import type { ToolSpec } from '../tools';
import type { AgentCoreHost } from './AgentCoreHost';
import { prepareChatTurn } from './prepareTurn';
import type { ChatRewindResult, ChatTurnMetadata, ChatTurnRequest, PreparedChatTurn } from './types';

function sameSessionRef(
  left: AgentEngineSessionRef | null,
  right: AgentEngineSessionRef | null,
): boolean {
  return (
    left?.sessionFile === right?.sessionFile &&
    (left?.leafId ?? null) === (right?.leafId ?? null)
  );
}

export class AgentCoreRuntime {
  private boundSessionRef: SessionRef | null = null;

  constructor(private readonly host: AgentCoreHost) {}

  get workspaceId(): string {
    return this.host.workspace.id;
  }

  get workspaceKind(): string {
    return this.host.workspace.kind;
  }

  private get sessionWorkspacePath(): string {
    return this.host.workspace.rootUri ?? this.host.workspace.id;
  }

  async createSession(): Promise<SessionRef> {
    const ref = await this.host.sessions.create(this.sessionWorkspacePath);
    this.bindSession(ref);
    return ref;
  }

  bindSession(ref: SessionRef | null, externalContextPaths?: string[]): void {
    if (sameSessionRef(this.boundSessionRef, ref)) {
      return;
    }

    if (ref === null) {
      this.host.engine.cancel();
      this.host.engine.resetSession();
      this.boundSessionRef = null;
      this.host.engine.syncSession(null, externalContextPaths);
      return;
    }

    if (this.boundSessionRef !== null) {
      this.host.engine.cancel();
      this.host.engine.resetSession();
    }

    this.boundSessionRef = ref;
    this.host.engine.syncSession(
      { sessionFile: ref.sessionFile, leafId: ref.leafId ?? null },
      externalContextPaths,
    );
  }

  getBoundSession(): SessionRef | null {
    return this.boundSessionRef;
  }

  async loadHistory(): Promise<ChatMessage[]> {
    if (this.boundSessionRef === null) {
      throw new Error('Cannot load AgentCoreRuntime history without a bound session.');
    }
    return this.host.sessions.getMessages(this.boundSessionRef);
  }

  listSessions(): Promise<StoreSessionInfo[]> {
    return this.host.sessions.listSessions(this.sessionWorkspacePath);
  }

  async listToolSpecs(context: Record<string, unknown> = {}): Promise<ToolSpec[]> {
    const toolLists = await Promise.all(
      this.host.tools.map((provider) => provider.listTools(context)),
    );
    return toolLists.flat();
  }

  syncSession(ref: AgentEngineSessionRef | null, externalContextPaths?: string[]): void {
    this.host.engine.syncSession(ref, externalContextPaths);
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return prepareChatTurn(request, this.host.mcp);
  }

  query(
    turn: PreparedChatTurn,
    openSessionHistory?: ChatMessage[],
    options?: AgentEngineTurnOptions,
  ): AsyncGenerator<StreamChunk> {
    return this.host.engine.query(turn, openSessionHistory, options);
  }

  cancel(): void {
    this.host.engine.cancel();
  }

  resetSession(): void {
    this.host.engine.resetSession();
  }

  getSessionId(): string | null {
    return this.host.engine.getSessionId();
  }

  rewind(checkpointId: string | null): Promise<ChatRewindResult> {
    return this.host.engine.rewind(checkpointId);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    return this.host.engine.consumeTurnMetadata();
  }

  cleanup(): void {
    this.host.engine.cleanup();
  }

  close(): void {
    if (this.boundSessionRef === null) {
      return;
    }
    this.host.engine.cancel();
    this.host.engine.resetSession();
    this.boundSessionRef = null;
  }
}
