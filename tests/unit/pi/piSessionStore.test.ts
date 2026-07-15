import type { AgentMessage } from '@earendil-works/pi-agent-core';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { FileStore } from '@pivi/pivi-agent-core/session';
import type { DeviceLocalExternalContextStore } from '@pivi/pivi-agent-core/session';
import { getPiviSessionDir } from '@pivi/pivi-agent-core/session/sessionPaths';
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

function createMigrationFixture(files: Record<string, string>) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-migration-'));
  for (const [file, content] of Object.entries(files)) {
    const absoluteFile = path.join(vaultPath, file);
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    fs.writeFileSync(absoluteFile, content);
  }
  const adapter = {
    listFilesRecursive: jest.fn(async () => Object.keys(files)),
    exists: jest.fn(async (file: string) => fs.existsSync(path.join(vaultPath, file))),
    read: jest.fn(async (file: string) => fs.readFileSync(path.join(vaultPath, file), 'utf8')),
    write: jest.fn(async (file: string, content: string) => {
      fs.writeFileSync(path.join(vaultPath, file), content);
    }),
  };
  return {
    adapter: adapter as unknown as FileStore,
    mocks: adapter,
    read: (file: string) => fs.readFileSync(path.join(vaultPath, file), 'utf8'),
    remove: () => fs.rmSync(vaultPath, { recursive: true, force: true }),
    vaultPath,
  };
}

describe('PiSessionStore range reads', () => {
  it('exposes recent and older durable message pages through SessionStore', async () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-store-range-'));
    const sessionFile = '.pivi/sessions/session.jsonl';
    const absoluteFile = path.join(vaultPath, sessionFile);
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    const line = (value: unknown) => `${JSON.stringify(value)}\n`;
    fs.writeFileSync(absoluteFile, [
      line({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: vaultPath }),
      line({ type: 'message', id: 'user-1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'one', timestamp: 1 } }),
      line({ type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: 'two', timestamp: 2 } }),
      line({ type: 'message', id: 'user-2', parentId: 'assistant-1', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'user', content: 'three', timestamp: 3 } }),
    ].join(''));
    const store = new PiSessionStore(
      { exists: async () => false } as unknown as FileStore,
      vaultPath,
    );
    const ref = { sessionFile, sessionId: 'session-1' };

    try {
      await expect(store.openRecent(ref, 2)).resolves.toMatchObject({
        messages: [{ id: 'user-1' }, { id: 'assistant-1' }, { id: 'user-2' }],
        hasOlder: false,
        totalMessageCount: 3,
      });
      await expect(store.readOlder(ref, 'assistant-1', 2)).resolves.toMatchObject({
        messages: [{ id: 'user-1' }],
        hasOlder: false,
        totalMessageCount: 3,
      });
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('opens session identity and lists indexed summaries without full snapshots', async () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-store-indexed-list-'));
    const sessionDir = getPiviSessionDir(vaultPath);
    const sessionFile = path.join(sessionDir, 'session.jsonl');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: vaultPath }),
      JSON.stringify({ type: 'message', id: 'user-1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'indexed preview', timestamp: 1 } }),
      JSON.stringify({ type: 'custom', id: 'meta-1', parentId: 'user-1', timestamp: '2026-01-01T00:00:02.000Z', customType: PIVI_SESSION_META, data: { title: 'Indexed title', titleSource: 'custom', lastResponseAt: 42 } }),
      '',
    ].join('\n'));
    const snapshotSpy = jest.spyOn(SessionTreeStore, 'openSnapshot');
    const store = new PiSessionStore(
      { exists: async () => false } as unknown as FileStore,
      vaultPath,
    );

    try {
      await expect(store.open(sessionFile)).resolves.toMatchObject({ sessionId: 'session-1' });
      await expect(store.listSessions(vaultPath)).resolves.toEqual([
        expect.objectContaining({
          sessionId: 'session-1',
          title: 'Indexed title',
          messagePreview: 'indexed preview',
          messageCount: 1,
          updatedAt: 42,
        }),
      ]);
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      snapshotSpy.mockRestore();
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
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
  it('keeps an unresolved model context window unknown instead of inventing a limit', async () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-store-usage-'));
    const sessionFile = '.pivi/sessions/session.jsonl';
    const absoluteFile = path.join(vaultPath, sessionFile);
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    fs.writeFileSync(absoluteFile, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: vaultPath }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          provider: '',
          model: 'missing-model',
          usage: { input: 300, output: 10, totalTokens: 310 },
        },
      }),
      '',
    ].join('\n'));
    const store = new PiSessionStore({} as FileStore, vaultPath);

    try {
      const usage = await store.getUsage({ sessionFile, sessionId: 'session-1' });
      expect(usage).toMatchObject({ contextWindow: 0, percentage: 0 });
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
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
    const content = `${JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/vault' })}\n${JSON.stringify({
      type: 'custom',
      id: 'ui-1',
      customType: PIVI_MESSAGE_UI,
      data: {
        targetEntryId: 'user-1',
        turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
      },
    })}\n`;
    const fixture = createMigrationFixture({ [sessionFile]: content });
    const externalContexts = {
      getSessionPaths: jest.fn(() => []),
      setSessionPaths: jest.fn(),
      getTurnPaths: jest.fn(() => []),
      setTurnPaths: jest.fn(),
      copySession: jest.fn(),
      deleteSession: jest.fn(),
    } satisfies DeviceLocalExternalContextStore;
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath, externalContexts);

    try {
      await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(1);
      expect(externalContexts.setTurnPaths).toHaveBeenCalledWith(
        sessionFile,
        'user-1',
        ['/device/root'],
      );
      expect(fixture.read(sessionFile)).not.toContain('externalContextPaths');
      await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(0);
      expect(fixture.mocks.read).toHaveBeenCalledTimes(1);
      expect(fixture.mocks.write).toHaveBeenCalledTimes(1);
    } finally {
      fixture.remove();
    }
  });

  it('records clean files once and skips body reads on later startup and lazy open', async () => {
    const sessionFile = '.pivi/sessions/clean.jsonl';
    const content = `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'clean',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/vault',
    })}\n`;
    const fixture = createMigrationFixture({ [sessionFile]: content });
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath);

    try {
      await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(0);
      expect(fixture.mocks.read).toHaveBeenCalledTimes(1);
      await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(0);
      await expect(store.open(sessionFile)).resolves.toMatchObject({ sessionId: 'clean' });
      expect(fixture.mocks.read).toHaveBeenCalledTimes(1);
      expect(fixture.mocks.write).not.toHaveBeenCalled();
    } finally {
      fixture.remove();
    }
  });

  it('coalesces concurrent migration requests for the same session file', async () => {
    const sessionFile = '.pivi/sessions/concurrent.jsonl';
    const content = `${JSON.stringify({ type: 'session', version: 3, id: 'concurrent', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/vault' })}\n${JSON.stringify({
      type: 'custom',
      id: 'context-1',
      customType: PIVI_UI_CONTEXT,
      data: { externalContextPaths: ['/device/root'] },
    })}\n`;
    const fixture = createMigrationFixture({ [sessionFile]: content });
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath);

    try {
      await expect(Promise.all([
        store.migrateDeviceLocalExternalContexts(),
        store.migrateDeviceLocalExternalContexts(),
      ])).resolves.toEqual([1, 1]);
      expect(fixture.mocks.read).toHaveBeenCalledTimes(1);
      expect(fixture.mocks.write).toHaveBeenCalledTimes(1);
    } finally {
      fixture.remove();
    }
  });

  it('rejects a source replacement before device-local state or JSONL is written', async () => {
    const sessionFile = '.pivi/sessions/stale.jsonl';
    const content = `${JSON.stringify({ type: 'session', version: 3, id: 'stale', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/vault' })}\n${JSON.stringify({
      type: 'custom',
      id: 'context-1',
      customType: PIVI_UI_CONTEXT,
      data: { externalContextPaths: ['/device/root'] },
    })}\n`;
    const fixture = createMigrationFixture({ [sessionFile]: content });
    const originalRead = fixture.mocks.read.getMockImplementation()!;
    fixture.mocks.read.mockImplementationOnce(async (file: string) => {
      const value = await originalRead(file);
      fs.appendFileSync(path.join(fixture.vaultPath, sessionFile), ' ');
      return value;
    });
    const externalContexts = {
      getSessionPaths: jest.fn(() => []),
      setSessionPaths: jest.fn(),
      getTurnPaths: jest.fn(() => []),
      setTurnPaths: jest.fn(),
      copySession: jest.fn(),
      deleteSession: jest.fn(),
    } satisfies DeviceLocalExternalContextStore;
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath, externalContexts);

    try {
      await expect(store.migrateDeviceLocalExternalContexts()).rejects.toThrow(
        'Live session source changed before mutation',
      );
      expect(externalContexts.setSessionPaths).not.toHaveBeenCalled();
      expect(externalContexts.setTurnPaths).not.toHaveBeenCalled();
      expect(fixture.mocks.write).not.toHaveBeenCalled();
    } finally {
      fixture.remove();
    }
  });

  it('skips a malformed legacy session at startup while migrating valid sessions', async () => {
    const validFile = '.pivi/sessions/valid-0.7.0.jsonl';
    const malformedFile = '.pivi/sessions/malformed-0.7.0.jsonl';
    const contents = new Map([
      [validFile, `${JSON.stringify({ type: 'session', version: 3, id: 'valid', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/vault' })}\n${JSON.stringify({
        type: 'custom',
        id: 'valid-ui',
        customType: PIVI_MESSAGE_UI,
        data: {
          targetEntryId: 'user-1',
          turnRequest: { text: 'hello', externalContextPaths: ['/device/root'] },
        },
      })}\n`],
      [malformedFile, '{"type":"session","id":"broken"}\nnot-json\n'],
    ]);
    const fixture = createMigrationFixture(Object.fromEntries(contents));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath);

    try {
      await expect(store.migrateDeviceLocalExternalContexts()).resolves.toBe(1);
      expect(fixture.read(validFile)).not.toContain('externalContextPaths');
      expect(fixture.read(malformedFile)).toContain('not-json');
      expect(fixture.mocks.write).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(
        `${malformedFile} at line 2`,
      ));
    } finally {
      warning.mockRestore();
      fixture.remove();
    }
  });

  it('still rejects a malformed session when that specific session is opened', async () => {
    const sessionFile = '.pivi/sessions/malformed-0.7.0.jsonl';
    const fixture = createMigrationFixture({
      [sessionFile]: '{"type":"session","id":"broken"}\nnot-json\n',
    });
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath);

    try {
      await expect(store.open(sessionFile)).rejects.toThrow(`${sessionFile} at line 2`);
    } finally {
      fixture.remove();
    }
  });

  it('does not rewrite JSONL when the device-local cache write fails', async () => {
    const sessionFile = '.pivi/sessions/a.jsonl';
    const content = `${JSON.stringify({
      type: 'custom',
      customType: PIVI_UI_CONTEXT,
      data: { externalContextPaths: ['/device/root'] },
    })}\n`;
    const fixture = createMigrationFixture({ [sessionFile]: content });
    const externalContexts = {
      getSessionPaths: jest.fn(() => []),
      setSessionPaths: jest.fn(() => { throw new Error('local storage unavailable'); }),
      getTurnPaths: jest.fn(() => []),
      setTurnPaths: jest.fn(),
      copySession: jest.fn(),
      deleteSession: jest.fn(),
    } satisfies DeviceLocalExternalContextStore;
    const store = new PiSessionStore(fixture.adapter, fixture.vaultPath, externalContexts);

    try {
      await expect(store.migrateDeviceLocalExternalContexts())
        .rejects.toThrow('local storage unavailable');
      expect(fixture.mocks.write).not.toHaveBeenCalled();
    } finally {
      fixture.remove();
    }
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
