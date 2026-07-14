import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { FileStore } from '@pivi/pivi-agent-core/session';
import type { DeviceLocalExternalContextStore } from '@pivi/pivi-agent-core/session';
import {
  PiSessionStore,
  stripExternalContextsFromSessionJsonl,
} from '@pivi/pivi-agent-core/engine/pi/session/piSessionStore';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
} from '@pivi/pivi-agent-core/session/types';

function countCustomEntries(vaultPath: string, sessionFile: string, customType: string): number {
  return SessionTreeStore.openSnapshot(vaultPath, sessionFile)
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
}

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

  it('skips a malformed legacy session at startup while migrating valid sessions', async () => {
    const validFile = '.pivi/sessions/valid-0.7.0.jsonl';
    const malformedFile = '.pivi/sessions/malformed-0.7.0.jsonl';
    const contents = new Map([
      [validFile, `${JSON.stringify({ type: 'session', id: 'valid' })}\n${JSON.stringify({
        type: 'custom',
        customType: PIVI_MESSAGE_UI,
        data: {
          targetEntryId: 'user-1',
          turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
        },
      })}\n`],
      [malformedFile, '{"type":"session","id":"broken"}\nnot-json\n'],
    ]);
    const adapter = {
      listFilesRecursive: jest.fn(async () => [validFile, malformedFile]),
      read: jest.fn(async (file: string) => contents.get(file) ?? ''),
      write: jest.fn(async (file: string, content: string) => { contents.set(file, content); }),
    } as unknown as FileStore;
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new PiSessionStore(adapter, '/vault');

    await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(1);

    expect(contents.get(validFile)).not.toContain('externalContextPaths');
    expect(contents.get(malformedFile)).toContain('not-json');
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(
      `${malformedFile} at line 2`,
    ));
    warning.mockRestore();
  });

  it('still rejects a malformed session when that specific session is opened', async () => {
    const sessionFile = '.pivi/sessions/malformed-0.7.0.jsonl';
    const adapter = {
      exists: jest.fn(async () => true),
      read: jest.fn(async () => '{"type":"session","id":"broken"}\nnot-json\n'),
    } as unknown as FileStore;
    const store = new PiSessionStore(adapter, '/vault');

    await expect(store.open(sessionFile)).rejects.toThrow(`${sessionFile} at line 2`);
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
