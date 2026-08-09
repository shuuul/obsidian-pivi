import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ImageAttachment } from '../../../foundation';
import type { Checkpoint, PiviCompactionDetails } from '../../../session/continuationSchemas';
import type { PiviMessageUiData, PiviSessionMetaData, PiviUiContextData } from '../../../session/types';
import type { MissingAgentMessagesOptions } from './agentMessageHistory';

export interface FullReplacementCompactionResult {
  boundaryId: string; checkpoint: Checkpoint; compactionId: string; summary: string;
}

export interface PiSessionTree {
  getSessionFile(): string;
  getSessionId(): string;
  getLeafId(): string | null;
  getEntries(): readonly SessionEntry[];
  getBranch(leafId?: string): readonly SessionEntry[];
  getVisiblePrefix(leafId?: string | null): readonly SessionEntry[];
  getLinearVisiblePrefix(): readonly SessionEntry[];
  getLinearLlmContextEntries(): readonly SessionEntry[];
  getActiveLlmContextEntries(): readonly SessionEntry[];
  loadAgentMessages(): AgentMessage[];
  findLastVisibleMessageEntryId(role: 'user' | 'assistant'): string | null;
  appendUserMessage(content: string, images?: ImageAttachment[]): Promise<string>;
  appendUserTurn(content: string, images?: ImageAttachment[],
    ui?: Omit<PiviMessageUiData, 'targetEntryId'>): Promise<string>;
  syncAgentMessages(messages: AgentMessage[], options?: MissingAgentMessagesOptions): Promise<void>;
  appendCustomMeta(data: PiviSessionMetaData): Promise<string>;
  appendSessionDeleted?(deletedAt: number): Promise<string>;
  appendUiContext(data: PiviUiContextData): Promise<string>;
  appendMessageUi(data: PiviMessageUiData): Promise<string>;
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number,
    details?: PiviCompactionDetails): Promise<string>;
  appendFullReplacementCompaction(tokensBefore: number,
    createCheckpoint: (boundaryId: string) => Checkpoint,
    renderSummary: (checkpoint: Checkpoint) => string): Promise<FullReplacementCompactionResult>;
  truncateAfter(entryId: string | null): Promise<boolean>;
  forkToNewTree(atEntryId: string): Promise<PiSessionTree | null>;
}

export interface PiSessionTreeFactory {
  create(): Promise<PiSessionTree>;
  open(sessionFile: string): Promise<PiSessionTree>;
  /** Retire a newly created tree that lost runtime generation before publication. */
  discardCreated?(tree: PiSessionTree): Promise<void>;
}
