import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ImageAttachment } from '../../../foundation';
import type { Checkpoint, PiviCompactionDetails } from '../../../session/continuationSchemas';
import type { PiviMessageUiData, PiviSessionMetaData, PiviUiContextData } from '../../../session/types';
import type { MissingAgentMessagesOptions } from './agentMessageHistory';
import type { FullReplacementCompactionResult, PiSessionTree, PiSessionTreeFactory } from './piSessionTree';
import { SessionTreeStore } from './sessionTreeStore';

class DesktopPiSessionTree implements PiSessionTree {
  constructor(private readonly store: SessionTreeStore, private readonly vaultPath = '') {}
  getSessionFile(): string { return this.store.getVaultRelativeSessionFile() ?? ''; }
  getSessionId(): string { return this.store.getSessionId(); }
  getLeafId(): string | null { return this.store.getLeafId(); }
  getEntries(): readonly SessionEntry[] { return this.store.getEntries(); }
  getBranch(leafId?: string): readonly SessionEntry[] { return this.store.getBranch(leafId); }
  getVisiblePrefix(leafId?: string | null): readonly SessionEntry[] { return this.store.getVisiblePrefix(leafId); }
  getLinearVisiblePrefix(): readonly SessionEntry[] { return this.store.getLinearVisiblePrefix(); }
  getLinearLlmContextEntries(): readonly SessionEntry[] { return this.store.getLinearLlmContextEntries(); }
  getActiveLlmContextEntries(): readonly SessionEntry[] { return this.store.getActiveLlmContextEntries(); }
  loadAgentMessages(): AgentMessage[] { return this.store.loadAgentMessages(); }
  findLastVisibleMessageEntryId(role: 'user' | 'assistant'): string | null { return this.store.findLastVisibleMessageEntryId(role); }
  async appendUserMessage(content: string, images?: ImageAttachment[]): Promise<string> { return this.store.appendUserMessage(content, images); }
  async appendUserTurn(content: string, images?: ImageAttachment[],
    ui?: Omit<PiviMessageUiData, 'targetEntryId'>): Promise<string> {
    const targetEntryId = this.store.appendUserMessage(content, images);
    if (ui) this.store.appendMessageUi({ ...ui, targetEntryId });
    return targetEntryId;
  }
  async syncAgentMessages(messages: AgentMessage[], options?: MissingAgentMessagesOptions): Promise<void> { this.store.syncAgentMessages(messages, options); }
  async appendCustomMeta(data: PiviSessionMetaData): Promise<string> { return this.store.appendCustomMeta(data); }
  async appendUiContext(data: PiviUiContextData): Promise<string> { return this.store.appendUiContext(data); }
  async appendMessageUi(data: PiviMessageUiData): Promise<string> { return this.store.appendMessageUi(data); }
  async appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: PiviCompactionDetails): Promise<string> {
    return this.store.appendCompaction(summary, firstKeptEntryId, tokensBefore, details);
  }
  async appendFullReplacementCompaction(tokensBefore: number, createCheckpoint: (id: string) => Checkpoint,
    renderSummary: (checkpoint: Checkpoint) => string): Promise<FullReplacementCompactionResult> {
    return this.store.appendFullReplacementCompaction(tokensBefore, createCheckpoint, renderSummary);
  }
  async truncateAfter(entryId: string | null): Promise<boolean> { return this.store.truncateAfter(entryId); }
  async forkToNewTree(atEntryId: string): Promise<PiSessionTree | null> {
    const path = this.store.forkToNewFile(atEntryId); return path ? new DesktopPiSessionTree(SessionTreeStore.open(this.vaultPath, path)) : null;
  }
}

export class DesktopPiSessionTreeFactory implements PiSessionTreeFactory {
  constructor(private readonly vaultPath: string) {}
  async create(): Promise<PiSessionTree> { return new DesktopPiSessionTree(SessionTreeStore.create(this.vaultPath), this.vaultPath); }
  async open(sessionFile: string): Promise<PiSessionTree> { return new DesktopPiSessionTree(SessionTreeStore.open(this.vaultPath, sessionFile), this.vaultPath); }
}
