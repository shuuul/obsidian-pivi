import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ImageAttachment } from '../../../foundation';
import { type Checkpoint, parsePiviCompactionDetails, type PiviCompactionDetails } from '../../../session/continuationSchemas';
import { sanitizeMessageUiForJsonl } from '../../../session/messageUi';
import {
  PIVI_SESSION_DELETED,
  type PiviMessageUiData,
  type PiviSessionMetaData,
  type PiviUiContextData,
} from '../../../session/types';
import { createMobileSessionPath } from '../../../session/vaultSessionPaths';
import { toPiImageContent } from '../piImageContent';
import { type MissingAgentMessagesOptions, sanitizeAgentMessagesForLlm } from './agentMessageHistory';
import { type PiSessionAppendPlan, PiSessionJsonlDocument, type PiSessionJsonlFactories } from './piSessionJsonlDocument';
import type { FullReplacementCompactionResult, PiSessionTree, PiSessionTreeFactory } from './piSessionTree';
import {
  activeLlmEntries,
  applyAsyncSubagentResultOverlays,
  contextMessages,
  lastVisibleEntryId,
  linearLlmEntries,
  linearVisibleEntries,
} from './piSessionTreeSemantics';
import {
  type SessionContentRevision,
  type SessionJsonlStorage,
  SessionRevisionError,
  SessionWriteUncertainError,
} from './sessionJsonlStorage';

function uuid(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function revisionsEqual(left: SessionContentRevision, right: SessionContentRevision): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function documentIsTombstoned(document: PiSessionJsonlDocument): boolean {
  return document.entries.some(entry => (
    entry.type === 'custom' && entry.customType === PIVI_SESSION_DELETED
  ));
}

export class VaultPiSessionTree implements PiSessionTree {
  private mutationQueue: Promise<void> = Promise.resolve();
  private invalidated = false;
  private tombstoned: boolean;

  constructor(private readonly storage: SessionJsonlStorage, private readonly path: string,
    private readonly document: PiSessionJsonlDocument, private revision: SessionContentRevision,
    private readonly factories: PiSessionJsonlFactories = {},
    /** Ordinary stale/uncertain invalidation: drop this live instance only (no epoch bump). */
    private readonly onInvalidated: (tree: VaultPiSessionTree) => void = () => undefined,
    private readonly onForked: (tree: VaultPiSessionTree) => void = () => undefined,
    /**
     * Terminal tombstone success: epoch-bumping factory forget so a pending pre-tombstone
     * open cannot remember() old bytes. Must not be wired for ordinary invalidate().
     */
    private readonly onTerminalForget: (tree: VaultPiSessionTree) => void = () => undefined) {
    this.tombstoned = documentIsTombstoned(document);
  }

  getSessionFile(): string { return this.path; }
  getSessionId(): string { return this.document.sessionId; }
  getLeafId(): string | null { return this.document.leafId; }
  getEntries(): readonly SessionEntry[] { return this.document.entries; }
  getBranch(leafId?: string): readonly SessionEntry[] { return this.document.getBranch(leafId); }
  getVisiblePrefix(leafId?: string | null): readonly SessionEntry[] {
    const branch = leafId === null ? [] : this.document.getBranch(leafId);
    const id = lastVisibleEntryId(branch); if (!id) return branch;
    const index = this.document.entries.findIndex(entry => entry.id === id);
    return index < 0 ? branch : this.document.entries.slice(0, index + 1);
  }
  getLinearVisiblePrefix(): readonly SessionEntry[] { return linearVisibleEntries(this.document.entries); }
  getLinearLlmContextEntries(): readonly SessionEntry[] { return linearLlmEntries(this.document.entries); }
  getActiveLlmContextEntries(): readonly SessionEntry[] { return activeLlmEntries(this.getLinearLlmContextEntries()); }
  loadAgentMessages(): AgentMessage[] {
    const messages = contextMessages(this.getLinearLlmContextEntries());
    return sanitizeAgentMessagesForLlm(applyAsyncSubagentResultOverlays(messages, this.document.entries));
  }
  findLastVisibleMessageEntryId(role: 'user' | 'assistant'): string | null {
    return lastVisibleEntryId(this.getLinearVisiblePrefix(), role);
  }
  matchesRevision(revision: SessionContentRevision): boolean {
    return revisionsEqual(this.revision, revision);
  }
  isTombstoned(): boolean { return this.tombstoned; }
  invalidate(): void {
    if (this.invalidated) return;
    this.invalidated = true;
    this.onInvalidated(this);
  }
  /**
   * Successful tombstone is terminal: mark invalidated and epoch-bump forget before the
   * mutation queue releases so concurrent open() cannot cache pre-tombstone bytes.
   */
  private terminalForgetAfterTombstone(): void {
    this.tombstoned = true;
    this.invalidated = true;
    this.onTerminalForget(this);
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.mutationQueue = current;
    await previous.catch(() => undefined);
    try {
      if (this.invalidated) throw new SessionRevisionError(this.path);
      if (this.tombstoned) throw new SessionRevisionError(this.path);
      return await operation();
    } catch (error) {
      if (error instanceof SessionRevisionError || error instanceof SessionWriteUncertainError) {
        this.invalidate();
      }
      throw error;
    } finally {
      release();
    }
  }
  private async append(plan: PiSessionAppendPlan): Promise<void> {
    if (!plan.appendBytes) return;
    const snapshot = await this.storage.append(this.path, plan.appendBytes, this.revision);
    this.document.apply(plan); this.revision = snapshot.revision;
  }
  async appendUserMessage(content: string, images?: ImageAttachment[]): Promise<string> {
    return this.appendUserTurn(content, images);
  }
  async appendUserTurn(content: string, images?: ImageAttachment[],
    ui?: Omit<PiviMessageUiData, 'targetEntryId'>): Promise<string> {
    return this.mutate(async () => {
      const messageContent: string | Array<TextContent | ImageContent> = images?.length
        ? [{ type: 'text', text: content }, ...toPiImageContent(images)] : content;
      const sanitized = ui ? sanitizeMessageUiForJsonl(ui).sanitized : undefined;
      const plan = this.document.planUserTurn(messageContent, Date.now(), sanitized);
      await this.append(plan);
      return plan.entries[0]!.id;
    });
  }
  async syncAgentMessages(messages: AgentMessage[], options?: MissingAgentMessagesOptions): Promise<void> {
    await this.mutate(() => this.append(this.document.planAgentMessageSync(messages, options, this.loadAgentMessages())));
  }
  async appendCustomMeta(data: PiviSessionMetaData): Promise<string> { return this.mutate(async () => { const p = this.document.planSessionMeta(data); await this.append(p); return p.entries[0]!.id; }); }
  async appendSessionDeleted(deletedAt: number): Promise<string> {
    return this.mutate(async () => {
      const p = this.document.planCustom(PIVI_SESSION_DELETED, { deletedAt });
      await this.append(p);
      // Epoch-bump before mutate()'s finally releases the queue.
      this.terminalForgetAfterTombstone();
      return p.entries[0]!.id;
    });
  }
  async appendUiContext(data: PiviUiContextData): Promise<string> { return this.mutate(async () => { const p = this.document.planUiContext(data); await this.append(p); return p.entries[0]!.id; }); }
  async appendMessageUi(data: PiviMessageUiData): Promise<string> { return this.mutate(async () => { const p = this.document.planMessageUi(sanitizeMessageUiForJsonl(data).sanitized); await this.append(p); return p.entries[0]!.id; }); }
  async appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: PiviCompactionDetails): Promise<string> {
    return this.mutate(async () => {
      const validated = details ? parsePiviCompactionDetails(details) ?? undefined : undefined;
      const p = this.document.planCompaction(summary, firstKeptEntryId, tokensBefore, validated); await this.append(p); return p.entries[0]!.id;
    });
  }
  async appendFullReplacementCompaction(tokensBefore: number, createCheckpoint: (id: string) => Checkpoint,
    renderSummary: (checkpoint: Checkpoint) => string): Promise<FullReplacementCompactionResult> {
    return this.mutate(async () => {
      let checkpoint!: Checkpoint; let summary = '';
      const plan = this.document.planFullReplacementCompaction(tokensBefore, boundaryId => {
        const details = parsePiviCompactionDetails({ piviCheckpoint: createCheckpoint(boundaryId) });
        if (!details) throw new Error('Invalid Pivi checkpoint for full-replacement compaction.');
        checkpoint = details.piviCheckpoint; summary = renderSummary(checkpoint).trim();
        if (!summary) throw new Error('Full-replacement compaction summary is empty.');
        return { summary, details };
      });
      await this.append(plan);
      return { boundaryId: plan.entries[0]!.id, checkpoint, compactionId: plan.entries[1]!.id, summary };
    });
  }
  async truncateAfter(entryId: string | null): Promise<boolean> {
    return this.mutate(async () => {
      if (entryId !== null && !this.document.getEntry(entryId)) return false;
      const plan = this.document.planTruncate(entryId);
      const snapshot = await this.storage.replace(this.path, plan.documentBytes, this.revision);
      this.document.apply(plan); this.revision = snapshot.revision; return true;
    });
  }
  async forkToNewTree(atEntryId: string): Promise<PiSessionTree | null> {
    return this.mutate(async () => {
      if (!this.document.getEntry(atEntryId)) return null;
      // Re-validate source revision before creating the fork file so a concurrent
      // external rewrite cannot be forked from a stale in-memory tree.
      const current = await this.storage.read(this.path);
      if (!revisionsEqual(current.revision, this.revision)) {
        throw new SessionRevisionError(this.path);
      }
      const plan = this.document.planFork(atEntryId, '', this.path);
      const path = createMobileSessionPath(plan.header.id, new Date(plan.header.timestamp));
      const snapshot = await this.storage.create(path, plan.documentBytes);
      const tree = new VaultPiSessionTree(this.storage, path,
        PiSessionJsonlDocument.parse(snapshot.content, { ...this.factories, revision: snapshot.revision }),
        snapshot.revision, this.factories, this.onInvalidated, this.onForked, this.onTerminalForget);
      this.onForked(tree);
      return tree;
    });
  }
}

export class VaultPiSessionTreeFactory implements PiSessionTreeFactory {
  private readonly live = new Map<string, VaultPiSessionTree>();
  private readonly opening = new Map<string, Promise<VaultPiSessionTree>>();
  /** Per-path epoch bumped by forget(); pending opens capture the epoch and discard on mismatch. */
  private readonly forgetEpoch = new Map<string, number>();

  constructor(private readonly storage: SessionJsonlStorage, private readonly factories: PiSessionJsonlFactories = {}) {}
  async create(): Promise<PiSessionTree> {
    const id = this.factories.sessionId?.() ?? uuid(); const path = createMobileSessionPath(id);
    const initial = PiSessionJsonlDocument.create('', { ...this.factories, sessionId: () => id });
    const snapshot = await this.storage.create(path, initial.sourceContent);
    const document = PiSessionJsonlDocument.parse(snapshot.content, {
      ...this.factories,
      revision: snapshot.revision,
    });
    return this.remember(this.bindTree(path, document, snapshot.revision));
  }
  async open(sessionFile: string): Promise<PiSessionTree> {
    const pending = this.opening.get(sessionFile);
    if (pending) return pending;
    const epoch = this.forgetEpoch.get(sessionFile) ?? 0;
    const opening = this.openFreshOrLive(sessionFile, epoch).finally(() => {
      if (this.opening.get(sessionFile) === opening) this.opening.delete(sessionFile);
    });
    this.opening.set(sessionFile, opening);
    return opening;
  }
  async discardCreated(tree: PiSessionTree): Promise<void> {
    if (!(tree instanceof VaultPiSessionTree)) return;
    await tree.appendSessionDeleted?.(Date.now());
  }
  forget(sessionFile: string): void {
    this.forgetEpoch.set(sessionFile, (this.forgetEpoch.get(sessionFile) ?? 0) + 1);
    this.live.get(sessionFile)?.invalidate();
    this.live.delete(sessionFile);
  }
  private remember(tree: VaultPiSessionTree): VaultPiSessionTree {
    this.live.set(tree.getSessionFile(), tree);
    return tree;
  }
  /** Ordinary invalidation: drop this instance only. Does not bump forgetEpoch. */
  private forgetIfSame(tree: VaultPiSessionTree): void {
    if (this.live.get(tree.getSessionFile()) === tree) this.live.delete(tree.getSessionFile());
  }
  /**
   * Terminal tombstone forget: bump epoch so in-flight open() capturing the prior epoch
   * cannot remember() pre-tombstone bytes after the mutation queue releases.
   */
  private terminalForget(tree: VaultPiSessionTree): void {
    this.forget(tree.getSessionFile());
  }
  private bindTree(path: string, document: PiSessionJsonlDocument, revision: SessionContentRevision): VaultPiSessionTree {
    return new VaultPiSessionTree(
      this.storage, path, document, revision, this.factories,
      t => this.forgetIfSame(t),
      t => this.remember(t),
      t => this.terminalForget(t),
    );
  }
  private assertOpenEpoch(sessionFile: string, epoch: number): void {
    if ((this.forgetEpoch.get(sessionFile) ?? 0) !== epoch) {
      throw new SessionRevisionError(sessionFile);
    }
  }

  private async openFreshOrLive(sessionFile: string, epoch: number): Promise<VaultPiSessionTree> {
    let snapshot = await this.storage.read(sessionFile);
    this.assertOpenEpoch(sessionFile, epoch);
    const existing = this.live.get(snapshot.path);
    if (existing?.matchesRevision(snapshot.revision)) {
      this.assertOpenEpoch(sessionFile, epoch);
      return existing;
    }
    existing?.invalidate();
    let document = PiSessionJsonlDocument.parse(snapshot.content, { ...this.factories, revision: snapshot.revision });
    if (document.migrationRequired) {
      snapshot = await this.storage.replace(snapshot.path, document.sourceContent, snapshot.revision);
      this.assertOpenEpoch(sessionFile, epoch);
      document = PiSessionJsonlDocument.parse(snapshot.content, { ...this.factories, revision: snapshot.revision });
    }
    const tree = this.bindTree(snapshot.path, document, snapshot.revision);
    // Final epoch check after all awaits so forget() cannot be overtaken by a late remember().
    this.assertOpenEpoch(sessionFile, epoch);
    return this.remember(tree);
  }
}
