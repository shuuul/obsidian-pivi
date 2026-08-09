import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const COMPACTION_SUMMARY_PREFIX = 'The conversation history before this point was compacted into the following summary:\n\n<summary>\n';
const COMPACTION_SUMMARY_SUFFIX = '\n</summary>';
const BRANCH_SUMMARY_PREFIX = 'The following is a summary of a branch that this conversation came back from:\n\n<summary>\n';
const BRANCH_SUMMARY_SUFFIX = '</summary>';

function buildSessionPath(entries: SessionEntry[]): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current = entries[entries.length - 1];
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/** Browser-safe equivalent of Pi's active, compaction-aware context projection. */
export function buildPiSessionContextEntries(entries: SessionEntry[]): SessionEntry[] {
  const path = buildSessionPath(entries);
  let compaction: Extract<SessionEntry, { type: 'compaction' }> | null = null;
  for (const entry of path) {
    if (entry.type === 'compaction') compaction = entry;
  }
  if (!compaction) return path;

  const compactionIndex = path.findIndex((entry) => entry.id === compaction.id);
  if (compactionIndex < 0) return path;

  const contextEntries: SessionEntry[] = [compaction];
  let foundFirstKept = false;
  for (let index = 0; index < compactionIndex; index++) {
    const entry = path[index]!;
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) contextEntries.push(entry);
  }
  contextEntries.push(...path.slice(compactionIndex + 1));
  return contextEntries;
}

/** Browser-safe equivalent of Pi's selected-entry to Agent message projection. */
export function piSessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
  if (entry.type === 'message') {
    const message = entry.message;
    if (
      (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult')
      && message.content == null
    ) {
      return [{ ...message, content: [] } as AgentMessage];
    }
    return [message];
  }
  if (entry.type === 'custom_message') {
    return [{
      role: 'custom',
      customType: entry.customType,
      content: entry.content ?? [],
      display: entry.display,
      details: entry.details,
      timestamp: new Date(entry.timestamp).getTime(),
    }];
  }
  if (entry.type === 'branch_summary' && entry.summary) {
    return [{
      role: 'branchSummary',
      summary: entry.summary,
      fromId: entry.fromId,
      timestamp: new Date(entry.timestamp).getTime(),
      content: BRANCH_SUMMARY_PREFIX + entry.summary + BRANCH_SUMMARY_SUFFIX,
    } as AgentMessage];
  }
  if (entry.type === 'compaction') {
    return [{
      role: 'compactionSummary',
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
      content: COMPACTION_SUMMARY_PREFIX + entry.summary + COMPACTION_SUMMARY_SUFFIX,
    } as AgentMessage];
  }
  return [];
}
