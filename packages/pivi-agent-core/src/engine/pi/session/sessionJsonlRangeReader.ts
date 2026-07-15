import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ChatMessage } from '../../../foundation';
import {
  PIVI_MESSAGE_UI,
  SessionIndexCorruptError,
  type SessionMessagePage,
  SessionRangeCursorError,
} from '../../../session/types';
import {
  collectMessageUiMap,
  entriesToChatMessages,
} from './messageMapper';
import {
  ensureSessionJsonlIndex,
  readSessionJsonlIndexedLine,
  type SessionJsonlIndex,
  type SessionJsonlIndexLine,
  validateSessionJsonlIndexSource,
} from './sessionJsonlIndex';

interface ProjectionGroup {
  id: string;
  lines: SessionJsonlIndexLine[];
  rawEntryIds: string[];
  kind: 'user' | 'assistant' | 'compaction';
  userTextSha256?: string;
}

export interface SessionJsonlRangeReadStats {
  entryCount: number;
  byteCount: number;
}

export interface SessionJsonlMessagePageResult extends SessionMessagePage {
  stats: SessionJsonlRangeReadStats;
}

function positiveLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError('Session message page limit must be a positive safe integer');
  }
  return limit;
}

function userTextHashes(index: SessionJsonlIndex): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of index.entries) {
    if (line.role === 'user') {
      if (!line.userTextSha256) {
        throw new SessionIndexCorruptError(
          `Session index is missing user projection metadata for ${line.id}`,
          index.sessionFile,
        );
      }
      hashes.set(line.id, line.userTextSha256);
      continue;
    }
    if (line.customType === PIVI_MESSAGE_UI
      && line.targetEntryId
      && line.targetDisplayTextSha256) {
      hashes.set(line.targetEntryId, line.targetDisplayTextSha256);
    }
  }
  return hashes;
}

function projectionGroups(index: SessionJsonlIndex): ProjectionGroup[] {
  const groups: ProjectionGroup[] = [];
  const userHashes = userTextHashes(index);
  let assistant: ProjectionGroup | null = null;
  let lastVisibleIndex = -1;
  for (let entryIndex = index.entries.length - 1; entryIndex >= 0; entryIndex--) {
    const line = index.entries[entryIndex];
    if (line?.entryType === 'message' && (line.role === 'user' || line.role === 'assistant')) {
      lastVisibleIndex = entryIndex;
      break;
    }
  }
  const visibleEntries = lastVisibleIndex >= 0
    ? index.entries.slice(0, lastVisibleIndex + 1)
    : index.entries;

  for (const line of visibleEntries) {
    if (line.entryType === 'compaction') {
      groups.push({
        id: line.id,
        kind: 'compaction',
        lines: [line],
        rawEntryIds: [line.id],
      });
      assistant = null;
      continue;
    }
    if (line.entryType !== 'message') {
      continue;
    }
    if (line.role === 'user') {
      const userTextSha256 = userHashes.get(line.id);
      const previous = groups.at(-1);
      const group: ProjectionGroup = {
        id: line.id,
        kind: 'user',
        lines: [line],
        rawEntryIds: [line.id],
        userTextSha256,
      };
      if (previous?.kind === 'user' && previous.userTextSha256 === userTextSha256) {
        groups[groups.length - 1] = group;
      } else {
        groups.push(group);
      }
      assistant = null;
      continue;
    }
    if (line.role === 'assistant') {
      if (!assistant) {
        assistant = {
          id: line.id,
          kind: 'assistant',
          lines: [],
          rawEntryIds: [],
        };
        groups.push(assistant);
      }
      assistant.lines.push(line);
      assistant.rawEntryIds.push(line.id);
      continue;
    }
    if (assistant) {
      assistant.lines.push(line);
      assistant.rawEntryIds.push(line.id);
    }
  }
  return groups;
}

function readGroups(
  index: SessionJsonlIndex,
  groups: readonly ProjectionGroup[],
): { messages: ChatMessage[]; stats: SessionJsonlRangeReadStats } {
  const selectedIds = new Set(groups.flatMap((group) => group.rawEntryIds));
  const selectedLines = new Map<number, SessionJsonlIndexLine>();
  for (const group of groups) {
    for (const line of group.lines) {
      selectedLines.set(line.offset, line);
    }
  }
  for (const line of index.entries) {
    if (line.customType === PIVI_MESSAGE_UI
      && line.targetEntryId
      && selectedIds.has(line.targetEntryId)) {
      selectedLines.set(line.offset, line);
    }
  }

  const lines = [...selectedLines.values()].sort((a, b) => a.offset - b.offset);
  const entries = lines.map((line) => (
    readSessionJsonlIndexedLine(index, line) as unknown as SessionEntry
  ));
  return {
    messages: entriesToChatMessages(entries, collectMessageUiMap(entries)),
    stats: {
      entryCount: lines.length,
      byteCount: lines.reduce((total, line) => total + line.length, 0),
    },
  };
}

function pageFromGroups(
  index: SessionJsonlIndex,
  groups: readonly ProjectionGroup[],
  start: number,
  limit: number,
): SessionJsonlMessagePageResult {
  validateSessionJsonlIndexSource(index);
  const safeStart = start > 0
    && groups[start]?.kind === 'assistant'
    && groups[start - 1]?.kind === 'user'
    ? start - 1
    : start;
  const selected = groups.slice(safeStart, start + limit);
  const { messages, stats } = readGroups(index, selected);
  if (messages.length !== selected.length) {
    throw new SessionIndexCorruptError(
      'Indexed message groups did not reconstruct to the expected page size',
      index.sessionFile,
    );
  }
  return {
    messages,
    hasOlder: safeStart > 0,
    totalMessageCount: groups.length,
    olderMessageCount: safeStart,
    olderUserMessageCount: groups
      .slice(0, safeStart)
      .filter((group) => group.kind === 'user')
      .length,
    stats,
  };
}

export function openRecentSessionJsonlMessages(
  sessionFile: string,
  limit: number,
): SessionJsonlMessagePageResult {
  const index = ensureSessionJsonlIndex(sessionFile);
  const groups = projectionGroups(index);
  const size = positiveLimit(limit);
  return pageFromGroups(index, groups, Math.max(0, groups.length - size), size);
}

export function readOlderSessionJsonlMessages(
  sessionFile: string,
  beforeEntryId: string,
  limit: number,
): SessionJsonlMessagePageResult {
  const index = ensureSessionJsonlIndex(sessionFile);
  const groups = projectionGroups(index);
  const before = groups.findIndex((group) => group.id === beforeEntryId);
  if (before < 0) {
    throw new SessionRangeCursorError(
      `Session message cursor ${beforeEntryId} was not found`,
      sessionFile,
      beforeEntryId,
    );
  }
  const size = positiveLimit(limit);
  const start = Math.max(0, before - size);
  return pageFromGroups(index, groups, start, before - start);
}
