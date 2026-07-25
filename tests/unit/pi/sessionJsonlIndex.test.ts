import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

import {
  assertSessionJsonlSourceUnchanged,
  ensureSessionJsonlIndex,
  captureSessionJsonlSource,
  getSessionJsonlIndexPath,
  invalidateSessionJsonlIndex,
  loadSessionJsonlIndex,
  readSessionJsonlIndexedLine,
  rebuildSessionJsonlIndex,
  refreshSessionJsonlIndexAfterAppend,
  validateSessionJsonlIndexSource,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlIndex';
import {
  SessionIndexCorruptError,
  SessionIndexStaleError,
} from '@pivi/pivi-agent-core/session';

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe('sessionJsonlIndex', () => {
  let root: string;
  let sessionFile: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-index-'));
    sessionFile = path.join(root, 'session.jsonl');
    fs.writeFileSync(sessionFile, [
      line({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      line({ type: 'message', id: 'user-1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: '你好' } }),
    ].join(''));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('builds UTF-8 byte offsets and verifies indexed lines', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);

    expect(index.header.offset).toBe(0);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]?.offset).toBe(Buffer.byteLength(line({
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: root,
    })));
    expect(readSessionJsonlIndexedLine(index, index.entries[0]!)).toEqual(expect.objectContaining({
      id: 'user-1',
      message: expect.objectContaining({ content: '你好' }),
    }));
  });

  it('extends both JSONL and index files without changing prior bytes', () => {
    const initial = rebuildSessionJsonlIndex(sessionFile);
    const priorIndexBytes = fs.readFileSync(initial.indexFile);
    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-1',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { targetEntryId: 'user-1' },
    }));

    refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      initial.source,
      ['ui-1'],
    );

    const nextIndexBytes = fs.readFileSync(initial.indexFile);
    expect(nextIndexBytes.subarray(0, priorIndexBytes.length)).toEqual(priorIndexBytes);
    const loaded = loadSessionJsonlIndex(sessionFile);
    expect(loaded?.entries.map((entry) => entry.id)).toEqual(['user-1', 'ui-1']);
    expect(loaded?.entries[1]?.targetEntryId).toBe('user-1');
    expect(loaded?.migrations.externalContexts).toBe(1);
  });

  it('marks legacy external-context payloads for one-time migration', () => {
    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'legacy-ui-1',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: {
        targetEntryId: 'user-1',
        turnRequest: { text: 'inspect', externalContextPaths: ['/device/path'] },
      },
    }));

    const index = rebuildSessionJsonlIndex(sessionFile);

    expect(index.entries[1]).toEqual(expect.objectContaining({
      targetEntryId: 'user-1',
      hasLegacyExternalContext: true,
    }));
    expect(index.migrations.externalContexts).toBe(0);
  });

  it('delegates legacy Pi format migration before building offsets', () => {
    fs.writeFileSync(sessionFile, [
      line({ type: 'session', id: 'legacy-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      line({ type: 'message', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'legacy' } }),
    ].join(''));
    const migration = jest.spyOn(SessionManager, 'open').mockImplementation((file) => {
      const values = fs.readFileSync(file, 'utf8').trim().split('\n').map((value) => JSON.parse(value));
      values[0].version = 3;
      values[1].id = 'migrated-user-1';
      values[1].parentId = null;
      fs.writeFileSync(file, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
      return SessionManager.inMemory();
    });

    const index = rebuildSessionJsonlIndex(sessionFile);

    expect(migration).toHaveBeenCalledWith(sessionFile);
    expect(index.entries.map((entry) => entry.id)).toEqual(['migrated-user-1']);
  });

  it('fails explicitly after external replacement and rebuilds from JSONL', () => {
    rebuildSessionJsonlIndex(sessionFile);
    const replacement = `${sessionFile}.replacement`;
    fs.writeFileSync(replacement, [
      line({ type: 'session', version: 3, id: 'session-2', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      line({ type: 'message', id: 'other-1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'other' } }),
    ].join(''));
    fs.renameSync(replacement, sessionFile);

    expect(() => loadSessionJsonlIndex(sessionFile)).toThrow(SessionIndexStaleError);
    expect(rebuildSessionJsonlIndex(sessionFile).entries.map((entry) => entry.id)).toEqual(['other-1']);
  });

  it('detects same-size edits even when the modified time is restored', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);
    const previousStats = fs.statSync(sessionFile);
    const content = fs.readFileSync(sessionFile);
    const target = index.entries[0]!;
    content[target.offset + target.length - 2] = content[target.offset + target.length - 2] === 0x61
      ? 0x62
      : 0x61;
    fs.writeFileSync(sessionFile, content);
    fs.utimesSync(sessionFile, previousStats.atime, previousStats.mtime);

    expect(() => loadSessionJsonlIndex(sessionFile)).toThrow(SessionIndexStaleError);
  });

  it('ignores metadata-only mode changes before validating and indexing an append', () => {
    const initial = rebuildSessionJsonlIndex(sessionFile);
    const before = fs.statSync(sessionFile, { bigint: true });
    fs.chmodSync(sessionFile, Number(before.mode) ^ 0o100);
    const after = fs.statSync(sessionFile, { bigint: true });

    expect(after.mode).not.toBe(before.mode);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(() => assertSessionJsonlSourceUnchanged(sessionFile, initial.source)).not.toThrow();
    expect(() => validateSessionJsonlIndexSource(initial)).not.toThrow();

    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-after-metadata-drift',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { targetEntryId: 'user-1' },
    }));

    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      initial.source,
      ['ui-after-metadata-drift'],
    )).not.toThrow();
    expect(loadSessionJsonlIndex(sessionFile)?.entries.at(-1)?.id)
      .toBe('ui-after-metadata-drift');
  });

  it('rejects unexpected appended entries instead of silently rebuilding', () => {
    const source = captureSessionJsonlSource(sessionFile);
    fs.appendFileSync(sessionFile, line({
      type: 'message',
      id: 'external-1',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      message: { role: 'assistant', content: 'external' },
    }));

    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      source,
      ['expected-1'],
    )).toThrow(SessionIndexStaleError);
    expect(loadSessionJsonlIndex(sessionFile)).toBeNull();
  });

  it('detects a mismatched line checksum even when using a loaded index', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);
    const content = fs.readFileSync(sessionFile);
    const target = index.entries[0]!;
    content[target.offset + target.length - 2] = content[target.offset + target.length - 2] === 0x61 ? 0x62 : 0x61;
    fs.writeFileSync(sessionFile, content);

    expect(() => readSessionJsonlIndexedLine(index, target)).toThrow(SessionIndexStaleError);
  });

  it('validates the complete source fingerprint before a held-index batch read', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);
    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'external',
      id: 'external-1',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
    }));

    expect(() => validateSessionJsonlIndexSource(index)).toThrow(SessionIndexStaleError);
  });

  it('rejects sidecar offset edits through the checkpoint checksum chain', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);
    const indexLines = fs.readFileSync(index.indexFile, 'utf8').trimEnd().split('\n');
    const entry = JSON.parse(indexLines[2]!) as { offset: number };
    entry.offset += 1;
    indexLines[2] = JSON.stringify(entry);
    fs.writeFileSync(index.indexFile, `${indexLines.join('\n')}\n`);

    expect(() => loadSessionJsonlIndex(sessionFile)).toThrow(SessionIndexCorruptError);
  });

  it('rejects a torn sidecar without its final checkpoint', () => {
    const index = rebuildSessionJsonlIndex(sessionFile);
    const indexLines = fs.readFileSync(index.indexFile, 'utf8').trimEnd().split('\n');
    fs.writeFileSync(index.indexFile, `${indexLines.slice(0, -1).join('\n')}\n`);

    expect(() => loadSessionJsonlIndex(sessionFile)).toThrow(SessionIndexCorruptError);
  });

  it('invalidates rewrite boundaries and lazily rebuilds missing indexes', () => {
    rebuildSessionJsonlIndex(sessionFile);
    const indexFile = getSessionJsonlIndexPath(sessionFile);

    invalidateSessionJsonlIndex(sessionFile);

    expect(fs.existsSync(indexFile)).toBe(false);
    expect(loadSessionJsonlIndex(sessionFile)).toBeNull();
    expect(ensureSessionJsonlIndex(sessionFile).entries).toHaveLength(1);
  });

  it('rebuilds a stale cached index instead of failing a validated append', () => {
    const initial = rebuildSessionJsonlIndex(sessionFile);
    // Cloud-sync style replacement: identical bytes on a new inode/mtime.
    const replacement = `${sessionFile}.replacement`;
    fs.copyFileSync(sessionFile, replacement);
    fs.renameSync(replacement, sessionFile);
    const previous = captureSessionJsonlSource(sessionFile);
    expect(previous.inode).not.toBe(initial.source.inode);

    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-resync',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { targetEntryId: 'user-1' },
    }));

    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      previous,
      ['ui-resync'],
    )).not.toThrow();
    expect(loadSessionJsonlIndex(sessionFile)?.entries.map((entry) => entry.id))
      .toEqual(['user-1', 'ui-resync']);
  });

  it('rebuilds a missing index during append refresh instead of skipping it', () => {
    const initial = rebuildSessionJsonlIndex(sessionFile);
    invalidateSessionJsonlIndex(sessionFile);

    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-missing',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { targetEntryId: 'user-1' },
    }));

    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      initial.source,
      ['ui-missing'],
    )).not.toThrow();
    const loaded = loadSessionJsonlIndex(sessionFile);
    expect(loaded?.entries.map((entry) => entry.id)).toEqual(['user-1', 'ui-missing']);

    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-next',
      parentId: 'ui-missing',
      timestamp: '2026-01-01T00:00:03.000Z',
      data: { targetEntryId: 'user-1' },
    }));
    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      loaded!.source,
      ['ui-next'],
    )).not.toThrow();
    expect(loadSessionJsonlIndex(sessionFile)?.entries.at(-1)?.id).toBe('ui-next');
  });

  it('rebuilds a corrupt index during append refresh', () => {
    const initial = rebuildSessionJsonlIndex(sessionFile);
    invalidateSessionJsonlIndex(sessionFile);
    fs.writeFileSync(getSessionJsonlIndexPath(sessionFile), 'not json\n');

    fs.appendFileSync(sessionFile, line({
      type: 'custom',
      customType: 'pivi/message-ui',
      id: 'ui-corrupt',
      parentId: 'user-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { targetEntryId: 'user-1' },
    }));

    expect(() => refreshSessionJsonlIndexAfterAppend(
      sessionFile,
      initial.source,
      ['ui-corrupt'],
    )).not.toThrow();
    expect(loadSessionJsonlIndex(sessionFile)?.entries.at(-1)?.id).toBe('ui-corrupt');
  });
});
