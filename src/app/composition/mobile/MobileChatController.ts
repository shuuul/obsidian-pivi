import type { MentionBadgeParseContext, MentionVaultLookup } from '@pivi/pivi-agent-core/context/mentions';
import { parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { StoreSessionInfo } from '@pivi/pivi-agent-core/session/types';

import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';

import type { MobileReadiness, MobileWorkspace } from './MobileWorkspace';

const RECENT_MESSAGE_LIMIT = 40;

export interface MobileChatRow {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'notice' | 'error';
  text: string;
  toolName?: string;
  /** Stream identity used to update one tool row in place. */
  streamId?: string;
  /** Durable JSONL entry identity, when supplied by hydration or stream metadata. */
  entryId?: string;
}

export interface MobileChatControllerHost {
  render(state: MobileChatViewState): void;
}

export interface MobileChatViewState {
  readiness: MobileReadiness;
  sessions: StoreSessionInfo[];
  archivedSessions: StoreSessionInfo[];
  showArchived: boolean;
  sessionFile: string | null;
  sessionTitle: string;
  rows: MobileChatRow[];
  composer: string;
  turnActive: boolean;
  canSend: boolean;
  canStop: boolean;
  canRetry: boolean;
  status: string;
}

interface LastUserRequest {
  text: string;
  currentNotePath?: string;
  attachedFilePaths?: string[];
}

/** Resolve Mobile-safe @file and @folder tokens into Vault-relative turn context. */
export function collectMobileMentionFilePaths(
  text: string,
  vault: MentionVaultLookup,
): string[] | undefined {
  if (!text.includes('@')) return undefined;

  const context: MentionBadgeParseContext = {
    vault,
    mcpServerNames: new Set(),
  };
  const paths = new Set<string>();
  const folders = new Set<string>();
  for (const part of parseMessageMentions(text, context)) {
    if (part.kind === 'file') paths.add(part.path);
    if (part.kind === 'folder') folders.add(part.path.replace(/\/+$/, ''));
  }
  for (const file of vault.getFiles()) {
    for (const folder of folders) {
      if (file.path.startsWith(`${folder}/`)) paths.add(file.path);
    }
  }
  return paths.size > 0 ? [...paths].sort((a, b) => a.localeCompare(b)) : undefined;
}

/**
 * Compact Mobile chat orchestration over an injected workspace + PiChatService.
 * DOM stays in the view; this owns session/runtime/turn lifecycle and late-commit guards.
 */
export class MobileChatController {
  private runtime: PiChatService | null = null;
  private sessionFile: string | null = null;
  private sessionTitle = 'New chat';
  private sessions: StoreSessionInfo[] = [];
  private archived = new Set<string>();
  private showArchived = false;
  private rows: MobileChatRow[] = [];
  private composer = '';
  private turnActive = false;
  private lastUserRequest: LastUserRequest | null = null;
  private lastTurnFailed = false;
  private retryParentEntryId: string | null | undefined;
  private attemptRowsStart = 0;
  private cancelRequested = false;
  private status = '';
  private closed = false;
  private turnGeneration = 0;
  private navigationGeneration = 0;
  private actionGeneration = 0;
  private readonly unsubscribeSettings: () => void;

  constructor(
    private readonly workspace: MobileWorkspace,
    private readonly host: MobileChatControllerHost,
  ) {
    this.unsubscribeSettings = workspace.onSurfacesChanged(() => {
      this.detachRuntime();
      this.refreshReadiness();
    });
  }

  async open(): Promise<void> {
    if (this.closed) return;
    const generation = ++this.navigationGeneration;
    this.archived = this.workspace.archivedSessions.load();
    try {
      await this.reloadSessions();
    } catch (error) {
      if (this.isStaleNavigation(generation)) return;
      this.publish(`Could not load sessions: ${this.sanitizeError(error)}`);
      return;
    }
    if (this.isStaleNavigation(generation)) return;
    if (this.sessions[0]) {
      await this.openSession(this.sessions[0].sessionFile, generation);
    } else {
      this.publish('Choose a model and API key in settings, then send a message.');
    }
  }

  close(): void {
    this.closed = true;
    this.navigationGeneration += 1;
    this.turnGeneration += 1;
    this.runtime?.cancel();
    this.runtime?.cleanup();
    this.runtime = null;
    this.unsubscribeSettings();
  }

  setComposer(value: string): void {
    this.composer = value;
    this.publish();
  }

  async send(): Promise<void> {
    if (this.closed || this.turnActive) return;
    const readiness = this.workspace.readiness();
    if (!readiness.ready) {
      this.status = readiness.missing.join(' ');
      this.publish();
      return;
    }
    const text = this.composer.trim();
    if (!text) return;

    const currentNotePath = this.activeNotePath();
    const mentionedFilePaths = collectMobileMentionFilePaths(
      text,
      createMentionVaultLookup(this.workspace.app),
    );
    const attachedFilePaths = mentionedFilePaths?.filter(path => path !== currentNotePath);
    this.lastUserRequest = {
      text,
      ...(currentNotePath ? { currentNotePath } : {}),
      ...(attachedFilePaths?.length ? { attachedFilePaths } : {}),
    };
    this.lastTurnFailed = false;
    this.retryParentEntryId = undefined;
    this.composer = '';
    this.appendRow({ kind: 'user', text });
    this.attemptRowsStart = this.rows.length;
    await this.runTurn(this.lastUserRequest);
  }

  stop(): void {
    if (!this.turnActive || this.closed) return;
    this.cancelRequested = true;
    this.status = 'Stopping…';
    this.publish();
    this.runtime?.cancel();
  }

  async retry(): Promise<void> {
    if (this.closed || this.turnActive || !this.lastTurnFailed || !this.lastUserRequest) return;
    if (this.retryParentEntryId === undefined) {
      this.lastTurnFailed = false;
      this.publish('Retry unavailable because the failed turn cannot be safely rewound.');
      return;
    }
    const runtime = this.runtime;
    const actionGeneration = this.actionGeneration;
    if (!runtime) {
      this.lastTurnFailed = false;
      this.publish('Retry unavailable because the failed turn runtime is no longer available.');
      return;
    }
    let rewind;
    try {
      rewind = await runtime.rewind(this.retryParentEntryId);
    } catch (error) {
      if (this.closed || actionGeneration !== this.actionGeneration || runtime !== this.runtime) return;
      this.lastTurnFailed = false;
      this.publish(`Retry unavailable because rewind failed: ${this.sanitizeError(error)}`);
      return;
    }
    if (this.closed || actionGeneration !== this.actionGeneration || runtime !== this.runtime) return;
    if (!rewind.canRewind) {
      this.lastTurnFailed = false;
      this.publish(`Retry unavailable because rewind was refused${rewind.error ? `: ${this.sanitize(rewind.error)}` : '.'}`);
      return;
    }
    this.lastTurnFailed = false;
    this.rows = this.rows.slice(0, this.attemptRowsStart);
    this.appendRow({ kind: 'notice', text: 'Retrying the interrupted turn…' });
    this.attemptRowsStart = this.rows.length;
    await this.runTurn(this.lastUserRequest);
  }

  newChat(): void {
    if (this.closed || this.turnActive) return;
    this.actionGeneration += 1;
    this.navigationGeneration += 1;
    this.detachRuntime();
    this.sessionFile = null;
    this.sessionTitle = 'New chat';
    this.rows = [];
    this.composer = '';
    this.lastUserRequest = null;
    this.lastTurnFailed = false;
    this.retryParentEntryId = undefined;
    this.status = 'New chat';
    this.publish();
  }

  async pickSession(sessionFile: string): Promise<void> {
    if (this.closed || this.turnActive) return;
    this.actionGeneration += 1;
    const generation = ++this.navigationGeneration;
    await this.openSession(sessionFile, generation);
  }

  setShowArchived(value: boolean): void {
    this.showArchived = value;
    this.publish();
  }

  async rename(title: string): Promise<void> {
    const clean = title.trim();
    if (!clean || !this.sessionFile || this.closed || this.turnActive) return;
    const generation = ++this.actionGeneration;
    const file = this.sessionFile;
    const ref = await this.workspace.sessions.open(file);
    await this.workspace.sessions.writeSessionMeta(ref, { title: clean, titleSource: 'custom' });
    if (this.isStaleAction(generation, file)) return;
    this.sessionTitle = clean;
    await this.reloadSessions();
    if (this.isStaleAction(generation, file)) return;
    this.publish('Session renamed.');
  }

  async fork(): Promise<void> {
    if (!this.sessionFile || this.closed || this.turnActive) return;
    const generation = ++this.actionGeneration;
    const sourceFile = this.sessionFile;
    const ref = await this.workspace.sessions.open(sourceFile);
    const page = await this.workspace.sessions.openRecent(ref, RECENT_MESSAGE_LIMIT);
    const lastEntryId = this.lastDurableEntryId(page.messages);
    if (!lastEntryId || this.isStaleAction(generation, sourceFile)) {
      if (!lastEntryId) this.publish('Fork unavailable because no durable message was found.');
      return;
    }
    const forked = await this.workspace.sessions.fork(ref, lastEntryId);
    if (this.isStaleAction(generation, sourceFile)) return;
    await this.reloadSessions();
    if (this.isStaleAction(generation, sourceFile)) return;
    const navigation = ++this.navigationGeneration;
    await this.openSession(forked.sessionFile, navigation);
  }

  archive(): void {
    if (!this.sessionFile || this.closed || this.turnActive) return;
    const file = this.sessionFile;
    this.archived.add(file);
    this.workspace.archivedSessions.save(this.archived);
    this.actionGeneration += 1;
    this.selectFallback(file);
  }

  restore(sessionFile = this.sessionFile): void {
    if (!sessionFile || this.closed || this.turnActive) return;
    this.archived.delete(sessionFile);
    this.workspace.archivedSessions.save(this.archived);
    this.actionGeneration += 1;
    this.navigationGeneration += 1;
    this.publish('Session restored.');
  }

  async deleteCurrent(): Promise<void> {
    if (!this.sessionFile || this.closed || this.turnActive) return;
    const generation = ++this.actionGeneration;
    const file = this.sessionFile;
    this.detachRuntime();
    await this.workspace.sessions.deleteSession(file);
    if (this.closed || generation !== this.actionGeneration) return;
    this.archived.delete(file);
    this.workspace.archivedSessions.save(this.archived);
    await this.reloadSessions();
    if (this.closed || generation !== this.actionGeneration) return;
    this.selectFallback(file);
  }

  refreshReadiness(): void {
    if (this.closed) return;
    this.publish();
  }

  private async runTurn(request: LastUserRequest): Promise<void> {
    const generation = ++this.turnGeneration;
    this.turnActive = true;
    this.cancelRequested = false;
    this.status = 'Sending…';
    this.publish();

    try {
      const runtime = this.ensureRuntime();
      if (this.sessionFile) {
        runtime.syncSession({ sessionFile: this.sessionFile });
      } else {
        runtime.syncSession(null);
      }

      const prepared = runtime.prepareTurn({
        text: request.text,
        ...(request.currentNotePath ? { currentNotePath: request.currentNotePath } : {}),
        ...(request.attachedFilePaths ? { attachedFilePaths: request.attachedFilePaths } : {}),
      });

      let failed = false;
      for await (const chunk of runtime.query(prepared)) {
        if (this.closed || generation !== this.turnGeneration) return;
        failed = this.applyChunk(chunk) || failed;
        this.publish();
      }

      if (this.closed || generation !== this.turnGeneration) return;

      const updates = runtime.getSessionStateUpdates();
      if (typeof updates.sessionFile === 'string' && updates.sessionFile) {
        this.sessionFile = updates.sessionFile;
      }
      if (typeof updates.title === 'string' && updates.title) {
        this.sessionTitle = updates.title;
      }
      this.settleTurn(failed, runtime.consumeTurnMetadata().userParentEntryId);
      try {
        await this.reloadSessions();
      } catch (error) {
        if (!failed && !this.cancelRequested) {
          this.status = `Response saved, but the session list could not refresh: ${this.sanitizeError(error)}`;
        }
      }
    } catch (error) {
      if (this.closed || generation !== this.turnGeneration) return;
      const metadata = this.runtime?.consumeTurnMetadata() ?? {};
      this.retryParentEntryId = metadata.userParentEntryId;
      this.lastTurnFailed = metadata.userParentEntryId !== undefined;
      const message = this.sanitizeError(error);
      this.appendRow({ kind: 'error', text: message });
      this.status = this.lastTurnFailed
        ? 'Turn failed. Retry will safely replace this attempt.'
        : 'Turn failed. Retry is unavailable because safe rewind metadata is missing.';
    } finally {
      if (generation === this.turnGeneration) {
        this.turnActive = false;
        if (!this.closed) this.publish();
      }
    }
  }

  private applyChunk(chunk: StreamChunk): boolean {
    if (chunk.type === 'usage') {
      this.status = `Context: ${chunk.usage.contextTokens}/${chunk.usage.contextWindow || '?'} tokens`;
      return false;
    }
    if (chunk.type === 'context_compacting') {
      this.appendRow({ kind: 'notice', text: 'Compacting context…' });
      this.status = 'Compacting context…';
      return false;
    }
    if (chunk.type === 'context_compacted') {
      const transition = chunk.tokensBefore !== undefined && chunk.tokensAfter !== undefined
        ? ` (${chunk.tokensBefore} → ${chunk.tokensAfter} tokens)` : '';
      this.appendRow({ kind: 'notice', text: `Context compacted${transition}` });
      this.status = `Context compacted${transition}`;
      return false;
    }
    switch (chunk.type) {
      case 'text':
        this.appendOrExtend('assistant', this.sanitize(chunk.content));
        this.applyStreamEntryId(chunk);
        return false;
      case 'thinking':
        this.appendOrExtend('thinking', this.sanitize(chunk.content));
        return false;
      case 'tool_use':
        this.upsertToolRow(chunk.id, { kind: 'tool', text: 'running…', toolName: chunk.name, streamId: chunk.id });
        return false;
      case 'tool_result': {
        const owned = this.rows.find(row => row.kind === 'tool' && row.streamId === chunk.id);
        this.upsertToolRow(chunk.id, {
          kind: 'tool',
          text: this.toolResultText(chunk.content, chunk.isError === true),
          toolName: owned?.toolName ?? 'tool',
          streamId: chunk.id,
        });
        return false;
      }
      case 'tool_output': {
        const owned = this.rows.find(row => row.kind === 'tool' && row.streamId === chunk.id);
        this.upsertToolRow(chunk.id, {
          kind: 'tool', text: `${owned?.text ?? ''}${this.sanitize(chunk.content)}`,
          toolName: owned?.toolName ?? 'tool', streamId: chunk.id,
        });
        return false;
      }
      case 'notice':
        this.appendRow({ kind: 'notice', text: this.sanitize(chunk.content) });
        return false;
      case 'error':
        this.appendRow({ kind: 'error', text: this.sanitize(chunk.content) });
        return true;
      case 'retry_start':
        this.rows = this.rows.slice(0, this.attemptRowsStart);
        this.appendRow({
          kind: 'notice',
          text: this.sanitize(`Retry ${chunk.attempt}/${chunk.maxAttempts}: ${chunk.errorMessage}`),
        });
        this.attemptRowsStart = this.rows.length;
        return false;
      case 'retry_end':
        if (!chunk.success && chunk.finalError) {
          this.appendRow({ kind: 'error', text: this.sanitize(chunk.finalError) });
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private settleTurn(failed: boolean, parentEntryId: string | null | undefined): void {
    this.retryParentEntryId = parentEntryId;
    if (this.cancelRequested) {
      this.lastTurnFailed = parentEntryId !== undefined;
      this.appendRow({ kind: 'notice', text: 'Interrupted' });
      this.status = this.lastTurnFailed
        ? 'Interrupted. Retry will safely replace this attempt.'
        : 'Interrupted. Retry is unavailable because safe rewind metadata is missing.';
      return;
    }
    this.lastTurnFailed = failed && parentEntryId !== undefined;
    this.status = failed
      ? (this.lastTurnFailed
        ? 'Turn failed. Retry will safely replace this attempt.'
        : 'Turn failed. Retry is unavailable because safe rewind metadata is missing.')
      : '';
  }

  private toolResultText(content: string, isError: boolean): string {
    const sanitized = this.sanitize(content);
    if (sanitized) return sanitized;
    return isError ? 'Tool error' : 'done';
  }

  private appendOrExtend(kind: MobileChatRow['kind'], content: string): void {
    const last = this.rows[this.rows.length - 1];
    if (last && last.kind === kind && kind !== 'tool') {
      last.text += content;
      return;
    }
    this.appendRow({ kind, text: content });
  }

  private appendRow(row: MobileChatRow): void {
    this.rows = [...this.rows, row];
  }

  private upsertToolRow(id: string, row: MobileChatRow): void {
    const index = this.rows.findIndex(candidate => candidate.kind === 'tool' && candidate.streamId === id);
    if (index < 0) {
      this.appendRow(row);
      return;
    }
    this.rows = this.rows.map((candidate, candidateIndex) => candidateIndex === index ? row : candidate);
  }

  private sanitize(value: string): string {
    return this.workspace.sanitizeDiagnostic(value);
  }

  private ensureRuntime(): PiChatService {
    if (!this.runtime) {
      this.runtime = this.workspace.createChatRuntime();
    }
    return this.runtime;
  }

  private detachRuntime(): void {
    this.turnGeneration += 1;
    const updates = this.turnActive ? this.runtime?.getSessionStateUpdates() : undefined;
    if (typeof updates?.sessionFile === 'string' && updates.sessionFile) {
      this.sessionFile = updates.sessionFile;
    }
    if (typeof updates?.title === 'string' && updates.title) {
      this.sessionTitle = updates.title;
    }
    this.runtime?.cancel();
    this.runtime?.cleanup();
    this.runtime = null;
    this.turnActive = false;
    this.cancelRequested = false;
    this.status = '';
  }

  private async openSession(sessionFile: string, generation = ++this.navigationGeneration): Promise<void> {
    this.detachRuntime();
    const ref = await this.workspace.sessions.open(sessionFile);
    if (this.isStaleNavigation(generation)) return;
    const page = await this.workspace.sessions.openRecent(ref, RECENT_MESSAGE_LIMIT);
    if (this.isStaleNavigation(generation)) return;
    this.sessionFile = ref.sessionFile;
    const summary = this.sessions.find(item => item.sessionFile === sessionFile);
    this.sessionTitle = summary?.title || 'Chat';
    this.rows = page.messages.flatMap(message => this.rowsFromMessage(message));
    this.lastUserRequest = null;
    this.lastTurnFailed = false;
    this.retryParentEntryId = undefined;
    this.status = '';
    this.runtime = this.workspace.createChatRuntime();
    if (this.isStaleNavigation(generation)) {
      this.runtime.cleanup();
      this.runtime = null;
      return;
    }
    this.runtime.syncSession({ sessionFile: ref.sessionFile });
    this.publish();
  }

  private rowsFromMessage(message: ChatMessage): MobileChatRow[] {
    const rows: MobileChatRow[] = [];
    if (message.role === 'user') {
      rows.push({ kind: 'user', text: message.displayContent ?? message.content,
        entryId: message.userMessageId ?? message.id });
      return rows;
    }
    if (message.contentBlocks?.length) {
      for (const block of message.contentBlocks) {
        const row = this.rowFromBlock(message, block);
        if (row) rows.push(row);
      }
      return rows;
    }
    if (message.content) rows.push({ kind: 'assistant', text: this.sanitize(message.content),
      entryId: message.assistantMessageId ?? message.id });
    for (const tool of message.toolCalls ?? []) {
      rows.push({
        kind: 'tool',
        toolName: tool.name,
        text: this.sanitize(tool.result ?? tool.status),
        entryId: message.assistantMessageId ?? message.id,
      });
    }
    return rows;
  }

  private rowFromBlock(
    message: ChatMessage,
    block: NonNullable<ChatMessage['contentBlocks']>[number],
  ): MobileChatRow | null {
    const entryId = message.assistantMessageId ?? message.id;
    if (block.type === 'text' && block.content) return { kind: 'assistant', text: this.sanitize(block.content), entryId };
    if (block.type === 'thinking' && block.content) return { kind: 'thinking', text: this.sanitize(block.content) };
    if (block.type !== 'tool_use') return null;
    const tool = message.toolCalls?.find(call => call.id === block.toolId);
    return { kind: 'tool', toolName: tool?.name ?? 'tool',
      text: this.sanitize(tool?.result ?? tool?.status ?? ''), entryId };
  }

  private async reloadSessions(): Promise<void> {
    this.sessions = await this.workspace.sessions.listSessions('');
  }

  private isStaleNavigation(generation: number): boolean {
    return this.closed || generation !== this.navigationGeneration;
  }

  private isStaleAction(generation: number, sessionFile: string): boolean {
    return this.closed || generation !== this.actionGeneration || this.sessionFile !== sessionFile;
  }

  private lastDurableEntryId(messages: readonly ChatMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!;
      const id = message.assistantMessageId ?? message.userMessageId ?? message.id;
      if (id) return id;
    }
    return [...this.rows].reverse().find(row => row.entryId)?.entryId ?? null;
  }

  private applyStreamEntryId(chunk: StreamChunk): void {
    const metadata = chunk as StreamChunk & { entryId?: unknown; messageId?: unknown };
    const id = typeof metadata.entryId === 'string' ? metadata.entryId
      : typeof metadata.messageId === 'string' ? metadata.messageId : undefined;
    if (id && this.rows.length) this.rows[this.rows.length - 1]!.entryId = id;
  }

  private selectFallback(excluded: string): void {
    const fallback = this.sessions.find(item => item.sessionFile !== excluded
      && !this.archived.has(item.sessionFile));
    if (fallback) {
      const generation = ++this.navigationGeneration;
      void this.openSession(fallback.sessionFile, generation);
      return;
    }
    this.newChat();
  }

  private sanitizeError(error: unknown): string {
    return this.sanitize(error instanceof Error ? error.message : String(error));
  }

  private activeNotePath(): string | undefined {
    const file = this.workspace.app.workspace.getActiveFile?.();
    return file?.path;
  }

  private publish(status = this.status): void {
    if (this.closed) return;
    this.status = status;
    const readiness = this.workspace.readiness();
    this.host.render({
      readiness,
      sessions: this.sessions.filter(session => !this.archived.has(session.sessionFile)),
      archivedSessions: this.sessions.filter(session => this.archived.has(session.sessionFile)),
      showArchived: this.showArchived,
      sessionFile: this.sessionFile,
      sessionTitle: this.sessionTitle,
      rows: this.rows,
      composer: this.composer,
      turnActive: this.turnActive,
      canSend: readiness.ready && !this.turnActive && this.composer.trim().length > 0,
      canStop: this.turnActive,
      canRetry: !this.turnActive && this.lastTurnFailed && !!this.lastUserRequest,
      status: this.status,
    });
  }
}
