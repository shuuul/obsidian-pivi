import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import {
  type AgentReport,
  formatAgentReportForParent,
  parseAgentReport,
} from '../../../session/continuationSchemas';
import { PIVI_MESSAGE_UI, type PiviMessageUiData } from '../../../session/types';

function isVisible(entry: SessionEntry, role?: 'user' | 'assistant'): boolean {
  return entry.type === 'message'
    && (entry.message.role === (role ?? 'user')
      || (!role && entry.message.role === 'assistant'));
}

export function lastVisibleEntryId(
  entries: readonly SessionEntry[], role?: 'user' | 'assistant',
): string | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry && isVisible(entry, role)) return entry.id;
  }
  return null;
}

export function linearVisibleEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  const id = lastVisibleEntryId(entries);
  if (!id) return [...entries];
  const index = entries.findIndex(entry => entry.id === id);
  return [
    ...entries.slice(0, index + 1),
    ...entries.slice(index + 1).filter(entry => entry.type === 'compaction'),
  ];
}

export function linearLlmEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  const visibleId = lastVisibleEntryId(entries);
  let end = visibleId ? entries.findIndex(entry => entry.id === visibleId) : -1;
  entries.forEach((entry, index) => { if (entry.type === 'compaction') end = Math.max(end, index); });
  return end < 0 ? [...entries] : entries.slice(0, end + 1);
}

export function activeLlmEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  let latest = -1;
  entries.forEach((entry, index) => { if (entry.type === 'compaction') latest = index; });
  if (latest < 0) return [...entries];
  const compaction = entries[latest]!;
  if (compaction.type !== 'compaction') return [...entries];
  const kept = entries.slice(0, latest);
  const keptIndex = kept.findIndex(entry => entry.id === compaction.firstKeptEntryId);
  return [compaction, ...(keptIndex < 0 ? [] : kept.slice(keptIndex)), ...entries.slice(latest + 1)];
}

interface AsyncSubagentResult {
  agentId?: string;
  status: 'completed' | 'error';
  result: string;
  report?: AgentReport;
}

function persistedAsyncSubagentResults(entries: readonly SessionEntry[]): Map<string, AsyncSubagentResult> {
  const results = new Map<string, AsyncSubagentResult>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== PIVI_MESSAGE_UI) continue;
    const data = entry.data as PiviMessageUiData | undefined;
    for (const toolCall of data?.toolCalls ?? []) {
      const subagent = toolCall.subagent;
      if (!subagent || subagent.mode !== 'async') continue;
      const status = subagent.asyncStatus ?? subagent.status;
      if (status !== 'completed' && status !== 'error') continue;
      const result = subagent.result?.trim() || toolCall.result?.trim();
      if (!result) continue;
      const report = parseAgentReport(toolCall.toolUseResult?.agent_report);
      results.set(toolCall.id, {
        agentId: subagent.agentId,
        status,
        result,
        ...(report ? { report } : {}),
      });
    }
  }
  return results;
}

export function applyAsyncSubagentResultOverlays(
  messages: readonly AgentMessage[],
  entries: readonly SessionEntry[],
): AgentMessage[] {
  const results = persistedAsyncSubagentResults(entries);
  return messages.map((message) => {
    const record = message as unknown as Record<string, unknown>;
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
    const result = record.role === 'toolResult' && record.toolName === 'spawn_agent' && toolCallId
      ? results.get(toolCallId) : undefined;
    if (!result) return message;
    const status = result.status === 'error' ? 'failed' : 'completed';
    const header = result.agentId
      ? `Background sub-agent ${result.agentId} ${status}.`
      : `Background sub-agent ${status}.`;
    return {
      ...record,
      content: [{
        type: 'text',
        text: `${header}\n\n${result.report ? formatAgentReportForParent(result.report) : result.result}`,
      }],
      isError: result.status === 'error',
    } as unknown as AgentMessage;
  });
}

export function contextMessages(entries: readonly SessionEntry[]): AgentMessage[] {
  return activeLlmEntries(entries).flatMap((entry): AgentMessage[] => {
    if (entry.type === 'message') {
      const message = entry.message;
      if ((message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult')
        && message.content == null) return [{ ...message, content: [] } as AgentMessage];
      return [message];
    }
    if (entry.type === 'custom_message') return [{
      role: 'custom', customType: entry.customType, content: entry.content ?? [],
      display: entry.display, details: entry.details,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage];
    if (entry.type === 'compaction') return [{
      role: 'compactionSummary', summary: entry.summary, tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage];
    if (entry.type === 'branch_summary' && entry.summary) return [{
      role: 'branchSummary', summary: entry.summary, fromId: entry.fromId,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage];
    return [];
  });
}
