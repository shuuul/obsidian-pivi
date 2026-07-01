import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry, SessionTreeNode } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type { FileStore } from '../../../src/pi/storage/FileStore';
import { collectLeafSummaries, latestVisibleLeafId, PiSessionStore } from '../../../src/pi/session/PiSessionStore';

function messageEntry(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant' | 'toolResult',
  content: unknown,
): SessionEntry {
  const message = role === 'toolResult'
    ? {
        role,
        toolCallId: 'call-1',
        toolName: 'obsidian_list',
        content,
        isError: false,
        timestamp: 1,
      }
    : { role, content, timestamp: 1 };
  return {
    type: 'message',
    id,
    parentId,
    timestamp: `2026-01-01T00:00:0${id.slice(-1)}.000Z`,
    message: message as unknown as AgentMessage,
  };
}

function customEntry(id: string, parentId: string): SessionEntry {
  return {
    type: 'custom',
    id,
    parentId,
    timestamp: `2026-01-01T00:00:1${id.slice(-1)}.000Z`,
    customType: 'pivi/session_meta',
    data: { title: 'metadata' },
  } as unknown as SessionEntry;
}

function node(entry: SessionEntry, children: SessionTreeNode[] = []): SessionTreeNode {
  return { entry, children } as SessionTreeNode;
}

describe('PiSessionStore collectLeafSummaries', () => {
  it('collapses metadata-only leaves that share the same visible conversation endpoint', () => {
    const user = messageEntry('u1', null, 'user', 'hello');
    const assistant = messageEntry('a2', 'u1', 'assistant', [{ type: 'text', text: 'hi' }]);
    const olderMeta = customEntry('m3', 'a2');
    const newerMeta = customEntry('m4', 'a2');

    const summaries = collectLeafSummaries([
      node(user, [
        node(assistant, [
          node(olderMeta),
          node(newerMeta),
        ]),
      ]),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(expect.objectContaining({
      leafId: 'm4',
      messageCount: 2,
      turnCount: 1,
      depth: 1,
      messagePreview: 'hi',
    }));
  });

  it('counts visible messages instead of internal tool-result entries', () => {
    const user = messageEntry('u1', null, 'user', 'list files');
    const assistantToolCall = messageEntry('a2', 'u1', 'assistant', [
      { type: 'toolCall', id: 'call-1', name: 'obsidian_list', arguments: { path: '' } },
    ]);
    const toolResult = messageEntry('t3', 'a2', 'toolResult', [
      { type: 'text', text: '[{"path":"Notes","kind":"folder"}]' },
    ]);
    const assistantFinal = messageEntry('a4', 't3', 'assistant', [{ type: 'text', text: 'Found Notes.' }]);

    const summaries = collectLeafSummaries([
      node(user, [node(assistantToolCall, [node(toolResult, [node(assistantFinal)])])]),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(expect.objectContaining({
      leafId: 'a4',
      messageCount: 2,
      turnCount: 1,
      depth: 1,
      messagePreview: 'Found Notes.',
    }));
  });

  it('summarizes a selected state using the full visible prefix up to that content', () => {
    const firstUser = messageEntry('u1', null, 'user', 'first');
    const firstAssistant = messageEntry('a2', 'u1', 'assistant', [{ type: 'text', text: 'first answer' }]);
    const rootMeta = customEntry('m3', 'a2');
    const secondUser = messageEntry('u4', 'm3', 'user', 'second');
    const secondAssistant = messageEntry('a5', 'u4', 'assistant', [{ type: 'text', text: 'second answer' }]);

    const summaries = collectLeafSummaries([
      node(firstUser, [node(firstAssistant, [node(rootMeta, [node(secondUser, [node(secondAssistant)])])])]),
    ], [firstUser, firstAssistant, rootMeta, secondUser, secondAssistant]);

    expect(summaries[0]).toEqual(expect.objectContaining({
      leafId: 'a5',
      messageCount: 4,
      turnCount: 2,
      depth: 2,
      messagePreview: 'second answer',
    }));
  });

  it('selects the newest leaf that has visible conversation messages', () => {
    const rootMeta = customEntry('m1', 'root');
    const user = messageEntry('u2', 'root', 'user', 'hello');
    const blankMeta = customEntry('m9', 'root');

    const selected = latestVisibleLeafId([
      node(rootMeta),
      node(user),
      node(blankMeta),
    ]);

    expect(selected).toBe('u2');
  });
});

describe('PiSessionStore deleteSession', () => {
  it('deletes the vault-relative JSONL path expected by Obsidian vault adapters', async () => {
    const adapter = { delete: jest.fn() } as unknown as FileStore;
    const store = new PiSessionStore(adapter, '/vault');

    await store.deleteSession('/vault/.pivi/sessions/session.jsonl');

    expect(adapter.delete).toHaveBeenCalledWith('.pivi/sessions/session.jsonl');
  });
});
