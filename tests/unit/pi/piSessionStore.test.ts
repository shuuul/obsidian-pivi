import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry, SessionTreeNode } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type { FileStore } from '@pivi/pivi-agent-core/session';
import type { DeviceLocalExternalContextStore } from '@pivi/pivi-agent-core/session';
import {
  collectLeafSummaries,
  latestVisibleLeafId,
  PiSessionStore,
  stripExternalContextsFromSessionJsonl,
} from '@pivi/pivi-agent-core/engine/pi/session/piSessionStore';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
} from '@pivi/pivi-agent-core/session/types';

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
  return { entry, children };
}

function countCustomEntries(vaultPath: string, sessionFile: string, customType: string): number {
  return SessionTreeStore.openSnapshot(vaultPath, sessionFile)
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
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

describe('PiSessionStore usage restoration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps an unresolved model context window unknown instead of inventing a limit', async () => {
    jest.spyOn(SessionTreeStore, 'openSnapshot').mockReturnValue({
      loadAgentMessages: () => [{
        role: 'assistant',
        provider: '',
        model: 'missing-model',
        usage: { input: 300, output: 10, totalTokens: 310 },
      }],
    } as never);
    const store = new PiSessionStore({} as FileStore, '/vault');

    const usage = await store.getUsage({
      sessionFile: '.pivi/sessions/session.jsonl',
      sessionId: 'session-1',
    });

    expect(usage).toMatchObject({ contextWindow: 0, percentage: 0 });
  });
});

describe('PiSessionStore custom metadata persistence', () => {
  it('does not append duplicate session metadata entries when values are unchanged', async () => {
    const vaultPath = '/test/pi-session-store-meta-dedupe';
    const store = new PiSessionStore({ delete: jest.fn() } as unknown as FileStore, vaultPath);
    const ref = await store.create(vaultPath);

    await store.writeSessionMeta(ref, { title: 'Research', createdAt: 1, lastResponseAt: 2 });
    const afterFirstWrite = countCustomEntries(vaultPath, ref.sessionFile, PIVI_SESSION_META);

    await store.writeSessionMeta(ref, { title: 'Research', createdAt: 1, lastResponseAt: 2 });

    expect(countCustomEntries(vaultPath, ref.sessionFile, PIVI_SESSION_META)).toBe(afterFirstWrite);
  });

  it('does not append duplicate UI context entries when values are unchanged', async () => {
    const vaultPath = '/test/pi-session-store-ui-context-dedupe';
    const store = new PiSessionStore({ delete: jest.fn() } as unknown as FileStore, vaultPath);
    const ref = await store.create(vaultPath);

    await store.writeUiContext(ref, {
      currentNote: 'Daily.md',
      externalContextPaths: ['A.md'],
      enabledMcpServers: ['vault'],
    });
    const afterFirstWrite = countCustomEntries(vaultPath, ref.sessionFile, PIVI_UI_CONTEXT);

    await store.writeUiContext(ref, {
      currentNote: 'Daily.md',
      externalContextPaths: ['A.md'],
      enabledMcpServers: ['vault'],
    });

    expect(countCustomEntries(vaultPath, ref.sessionFile, PIVI_UI_CONTEXT)).toBe(afterFirstWrite);
  });
});

describe('PiSessionStore device-local external contexts', () => {
  it('strips legacy paths while preserving line order, untouched lines, and final newline', () => {
    const header = '{"type":"session","id":"session-1"}';
    const context = JSON.stringify({
      type: 'custom', customType: PIVI_UI_CONTEXT,
      data: { currentNote: 'Daily.md', externalContextPaths: ['/root'] },
    });
    const turn = JSON.stringify({
      type: 'custom', customType: PIVI_MESSAGE_UI,
      data: {
        targetEntryId: 'user-1',
        displayContent: 'hello',
        turnRequest: { text: 'hello', externalContextPaths: ['/turn'] },
      },
    });
    const original = `${header}\n${context}\n${turn}\n`;

    const migrated = stripExternalContextsFromSessionJsonl(original, 'session.jsonl');

    expect(migrated.changed).toBe(true);
    expect(migrated.sessionPaths).toEqual(['/root']);
    expect(migrated.turnPaths.get('user-1')).toEqual(['/turn']);
    expect(migrated.content.split('\n')[0]).toBe(header);
    expect(migrated.content.endsWith('\n')).toBe(true);
    expect(migrated.content).not.toContain('externalContextPaths');
    expect(stripExternalContextsFromSessionJsonl(
      migrated.content,
      'session.jsonl',
    ).changed).toBe(false);
  });

  it('fails with the session and line number when legacy JSONL is malformed', () => {
    expect(() => stripExternalContextsFromSessionJsonl(
      '{"type":"session"}\nnot-json\n',
      '.pivi/sessions/broken.jsonl',
    )).toThrow('.pivi/sessions/broken.jsonl at line 2');
  });

  it('migrates every legacy session before startup continues and is idempotent', async () => {
    const sessionFile = '.pivi/sessions/a.jsonl';
    let content = `${JSON.stringify({ type: 'session', id: 'session-1' })}\n${JSON.stringify({
      type: 'custom',
      customType: PIVI_MESSAGE_UI,
      data: {
        targetEntryId: 'user-1',
        turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
      },
    })}\n`;
    const adapter = {
      listFilesRecursive: jest.fn(async () => [sessionFile]),
      read: jest.fn(async () => content),
      write: jest.fn(async (_path: string, next: string) => { content = next; }),
    } as unknown as FileStore;
    const externalContexts = {
      getSessionPaths: jest.fn(() => []),
      setSessionPaths: jest.fn(),
      getTurnPaths: jest.fn(() => []),
      setTurnPaths: jest.fn(),
      copySession: jest.fn(),
      deleteSession: jest.fn(),
    } satisfies DeviceLocalExternalContextStore;
    const store = new PiSessionStore(adapter, '/vault', externalContexts);

    await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(1);
    expect(externalContexts.setTurnPaths).toHaveBeenCalledWith(
      sessionFile,
      'user-1',
      ['/device/root'],
    );
    expect(content).not.toContain('externalContextPaths');
    await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(0);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite JSONL when the device-local cache write fails', async () => {
    const sessionFile = '.pivi/sessions/a.jsonl';
    const content = `${JSON.stringify({
      type: 'custom',
      customType: PIVI_UI_CONTEXT,
      data: { externalContextPaths: ['/device/root'] },
    })}\n`;
    const adapter = {
      listFilesRecursive: jest.fn(async () => [sessionFile]),
      read: jest.fn(async () => content),
      write: jest.fn(),
    } as unknown as FileStore;
    const externalContexts = {
      getSessionPaths: jest.fn(() => []),
      setSessionPaths: jest.fn(() => { throw new Error('local storage unavailable'); }),
      getTurnPaths: jest.fn(() => []),
      setTurnPaths: jest.fn(),
      copySession: jest.fn(),
      deleteSession: jest.fn(),
    } satisfies DeviceLocalExternalContextStore;
    const store = new PiSessionStore(adapter, '/vault', externalContexts);

    await expect(store.migrateDeviceLocalExternalContexts())
      .rejects.toThrow('local storage unavailable');
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('keeps turn paths out of JSONL overlays and restores them from local cache', async () => {
    const vaultPath = '/test/pi-session-store-device-overlay';
    const adapter = {
      exists: jest.fn(async () => false),
      delete: jest.fn(),
    } as unknown as FileStore;
    const store = new PiSessionStore(adapter, vaultPath);
    const ref = await store.create(vaultPath);
    const updated = await store.appendUserTurn(ref, 'hello', {
      turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
    });

    const entries = SessionTreeStore.openSnapshot(vaultPath, updated.sessionFile).getEntries();
    const uiEntry = entries.find((entry) => (
      entry.type === 'custom' && entry.customType === PIVI_MESSAGE_UI
    ));
    expect(JSON.stringify(uiEntry)).not.toContain('externalContextPaths');
    const messages = await store.getMessages(updated);
    expect(messages[0]?.turnRequest?.externalContextPaths).toEqual(['/device/root']);
  });

  it('copies local turn overlays when a session is forked', async () => {
    const vaultPath = '/test/pi-session-store-device-fork';
    const adapter = {
      exists: jest.fn(async () => false),
      delete: jest.fn(),
    } as unknown as FileStore;
    const store = new PiSessionStore(adapter, vaultPath);
    const ref = await store.create(vaultPath);
    const updated = await store.appendUserTurn(ref, 'hello', {
      turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
    });
    const sourceMessages = await store.getMessages(updated);
    const userEntryId = sourceMessages[0]?.userMessageId;
    if (!userEntryId) throw new Error('Expected a persisted user entry');

    const forked = await store.fork(updated, userEntryId);

    expect((await store.getMessages(forked))[0]?.turnRequest?.externalContextPaths)
      .toEqual(['/device/root']);
  });
});
