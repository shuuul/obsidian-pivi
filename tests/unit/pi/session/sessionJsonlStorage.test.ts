import type { AtomicWorkspaceFileStore, WorkspaceFileStat } from '@pivi/pivi-agent-core/ports';
import {
  FileStoreSessionJsonlStorage,
  SessionRevisionError,
  SessionWriteUncertainError,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import {
  createMobileSessionPath,
  InvalidSessionPathError,
  requireVaultSessionPath,
} from '@pivi/pivi-agent-core/session/vaultSessionPaths';

const A = '.pivi/sessions/a.jsonl';
const B = '.pivi/sessions/legacy-device/b.jsonl';

class MemoryFiles implements AtomicWorkspaceFileStore {
  readonly data = new Map<string, string>();
  appendCalls = 0;
  processCalls = 0;
  appendHook?: (path: string, content: string) => Promise<void>;
  processHook?: (path: string, transform: (content: string) => string) => Promise<string>;
  writeHook?: (path: string, content: string) => Promise<void>;

  async exists(path: string): Promise<boolean> {
    return path === '.pivi/sessions' || this.data.has(path);
  }
  async read(path: string): Promise<string> {
    const value = this.data.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  }
  async write(path: string, content: string): Promise<void> {
    if (this.writeHook) return this.writeHook(path, content);
    this.data.set(path, content);
  }
  async append(path: string, content: string): Promise<void> {
    this.appendCalls += 1;
    if (this.appendHook) return this.appendHook(path, content);
    this.data.set(path, (this.data.get(path) ?? '') + content);
  }
  async process(path: string, transform: (content: string) => string): Promise<string> {
    this.processCalls += 1;
    if (this.processHook) return this.processHook(path, transform);
    const next = transform(await this.read(path));
    this.data.set(path, next);
    return next;
  }
  async delete(path: string): Promise<void> { this.data.delete(path); }
  async deleteFolder(): Promise<void> {}
  async listFiles(): Promise<string[]> { return []; }
  async listFolders(): Promise<string[]> { return []; }
  async listFilesRecursive(): Promise<string[]> { return [...this.data.keys()].reverse(); }
  async ensureFolder(): Promise<void> {}
  async rename(oldPath: string, newPath: string): Promise<void> {
    this.data.set(newPath, await this.read(oldPath));
    this.data.delete(oldPath);
  }
  async stat(path: string): Promise<WorkspaceFileStat | null> {
    const content = this.data.get(path);
    return content === undefined ? null : { mtime: 1, size: new TextEncoder().encode(content).byteLength };
  }
}

const digest = async (input: ArrayBuffer): Promise<ArrayBuffer> => {
  const output = new Uint8Array(32);
  for (const byte of new Uint8Array(input)) output[0] = ((output[0] ?? 0) + byte) % 256;
  return output.buffer;
};

describe('Vault session paths', () => {
  it.each([
    '/.pivi/sessions/a.jsonl',
    'C:/vault/.pivi/sessions/a.jsonl',
    '.pivi\\sessions\\a.jsonl',
    '.pivi/sessions/../a.jsonl',
    '.pivi/sessions/./a.jsonl',
    '.pivi/sessions/a.txt',
    'other/a.jsonl',
    `.pivi/sessions/a\0.jsonl`,
  ])('rejects %s', (path) => {
    expect(() => requireVaultSessionPath(path)).toThrow(InvalidSessionPathError);
  });

  it('accepts root and legacy nested paths and creates an ISO-safe root path', () => {
    expect(requireVaultSessionPath(A)).toBe(A);
    expect(requireVaultSessionPath(B)).toBe(B);
    expect(createMobileSessionPath('session-1', new Date('2026-08-09T12:34:56.789Z')))
      .toBe('.pivi/sessions/2026-08-09T12-34-56-789Z_session-1.jsonl');
  });
});

describe('FileStoreSessionJsonlStorage', () => {
  it('counts UTF-8 bytes and lists recursively in deterministic path order', async () => {
    const files = new MemoryFiles();
    files.data.set(B, '{}\n');
    files.data.set(A, '{"text":"雪"}\n');
    files.data.set('.pivi/sessions/ignored.txt', 'x');
    const storage = new FileStoreSessionJsonlStorage(files, digest);

    expect((await storage.read(A)).revision.bytes).toBe(new TextEncoder().encode('{"text":"雪"}\n').byteLength);
    expect((await storage.list()).map((entry) => entry.path)).toEqual([A, B]);
  });

  it('rejects create collisions and preserves the exact append prefix', async () => {
    const files = new MemoryFiles();
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const original = await storage.create(A, '{"first":1}\n');
    await expect(storage.create(A, 'x')).rejects.toThrow('already exists');
    const appended = await storage.append(A, '{"雪":2}\n', original.revision);
    expect(appended.content).toBe('{"first":1}\n{"雪":2}\n');
    expect(files.processCalls).toBe(1);
  });

  it('reconciles an exact create that landed before adapter rejection', async () => {
    const files = new MemoryFiles();
    files.writeHook = async (path, content) => {
      files.data.set(path, content);
      throw new Error('adapter disconnected after write');
    };
    const storage = new FileStoreSessionJsonlStorage(files, digest);

    await expect(storage.create(A, '{"first":1}\n')).resolves.toMatchObject({ path: A });
    expect(files.data.get(A)).toBe('{"first":1}\n');
  });

  it('reports an unverified create failure as uncertain', async () => {
    const files = new MemoryFiles();
    files.writeHook = async () => { throw new Error('adapter disconnected before write'); };
    const storage = new FileStoreSessionJsonlStorage(files, digest);

    await expect(storage.create(A, '{"first":1}\n'))
      .rejects.toBeInstanceOf(SessionWriteUncertainError);
  });

  it.each(['', '{}', '\n', 'null\n', '[]\n', 'not-json\n', '{}\n\n'])('rejects invalid append %p', async (content) => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const revision = (await storage.read(A)).revision;
    await expect(storage.append(A, content, revision)).rejects.toThrow(TypeError);
    expect(files.processCalls).toBe(0);
  });

  it('rejects stale append, replace, and delete before mutation', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const stale = { bytes: 0, sha256: '' };
    await expect(storage.append(A, '{"a":1}\n', stale)).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(storage.replace(A, 'changed', stale)).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(storage.delete(A, stale)).rejects.toBeInstanceOf(SessionRevisionError);
    expect(files.data.get(A)).toBe('{}\n');
  });

  it('rejects a replacement that lands between the revision read and atomic append', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    files.processHook = async (path, transform) => {
      files.data.set(path, '{"synced":true}\n');
      return transform(await files.read(path));
    };
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const revision = (await storage.read(A)).revision;

    await expect(storage.append(A, '{"local":true}\n', revision))
      .rejects.toBeInstanceOf(SessionRevisionError);

    expect(files.data.get(A)).toBe('{"synced":true}\n');
  });

  it('detects post-append divergence without retrying', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    files.processHook = async (path, transform) => {
      const committed = `${transform(await files.read(path))}diverged`;
      files.data.set(path, committed);
      return committed;
    };
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const revision = (await storage.read(A)).revision;
    await expect(storage.append(A, '{"a":1}\n', revision)).rejects.toBeInstanceOf(SessionWriteUncertainError);
    expect(files.processCalls).toBe(1);
  });

  it('sanitizes inside the atomic mutation after a queued credential change', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const processEntered = new Promise<void>((resolve) => { entered = resolve; });
    files.processHook = async (path, transform) => {
      entered();
      await gate;
      const next = transform(await files.read(path));
      files.data.set(path, next);
      return next;
    };
    let secret = '';
    const storage = new FileStoreSessionJsonlStorage(
      files,
      digest,
      content => secret ? content.replaceAll(secret, '[redacted]') : content,
    );
    const revision = (await storage.read(A)).revision;

    const append = storage.append(A, '{"content":"late-secret"}\n', revision);
    await processEntered;
    secret = 'late-secret';
    release();

    await expect(append).resolves.toMatchObject({
      content: '{}\n{"content":"[redacted]"}\n',
    });
    expect(files.data.get(A)).not.toContain('late-secret');
  });

  it('treats an atomic-process rejection as uncertain and never retries it', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    files.processHook = async () => { throw new Error('adapter disconnected'); };
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const revision = (await storage.read(A)).revision;

    await expect(storage.append(A, '{"a":1}\n', revision))
      .rejects.toBeInstanceOf(SessionWriteUncertainError);

    expect(files.processCalls).toBe(1);
  });

  it('recovers a failed path queue and does not block an unrelated path', async () => {
    const files = new MemoryFiles();
    files.data.set(A, '{}\n');
    files.data.set(B, '{}\n');
    const storage = new FileStoreSessionJsonlStorage(files, digest);
    const aRevision = (await storage.read(A)).revision;
    const bRevision = (await storage.read(B)).revision;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    files.processHook = async (path, transform) => {
      if (path === A) await gate;
      const next = transform(await files.read(path));
      files.data.set(path, next);
      return next;
    };
    const blocked = storage.append(A, '{"a":1}\n', aRevision);
    await expect(storage.append(B, '{"b":1}\n', bRevision)).resolves.toMatchObject({ path: B });
    release();
    await blocked;

    await expect(storage.append(A, 'bad', (await storage.read(A)).revision)).rejects.toThrow(TypeError);
    await expect(storage.replace(A, 'replacement', (await storage.read(A)).revision)).resolves.toMatchObject({ content: 'replacement' });
  });
});
