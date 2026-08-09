import { ObsidianVaultFileAdapter } from '../../packages/obsidian-host/src/storage/obsidianVaultFileAdapter';
import { FileStoreSessionJsonlStorage } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import { VaultPiSessionStore } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionStore';
import { VaultPiSessionTreeFactory } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree';
import type { App } from 'obsidian';

class MemoryDataAdapter {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  private readonly folders = new Set(['']);

  get basePath(): never { throw new Error('basePath must not be accessed'); }
  private record(path: string): void {
    if (/^(?:\/|[A-Za-z]:|\\\\)/.test(path) || path.includes('..')) {
      throw new Error(`Adapter received a non-Vault-relative path: ${path}`);
    }
    this.calls.push(path);
  }
  async exists(path: string) { this.record(path); return this.files.has(path) || this.folders.has(path); }
  async read(path: string) { this.record(path); const value = this.files.get(path); if (value === undefined) throw new Error('missing'); return value; }
  async write(path: string, value: string) { this.record(path); this.files.set(path, value); }
  async append(path: string, value: string) { this.record(path); this.files.set(path, (this.files.get(path) ?? '') + value); }
  async process(path: string, fn: (value: string) => string) { this.record(path); const value = fn(this.files.get(path) ?? ''); this.files.set(path, value); return value; }
  async remove(path: string) { this.record(path); this.files.delete(path); }
  async mkdir(path: string) { this.record(path); this.folders.add(path); }
  async rmdir(path: string) { this.record(path); this.folders.delete(path); }
  async rename(from: string, to: string) { this.record(from); this.record(to); this.files.set(to, this.files.get(from)!); this.files.delete(from); }
  async stat(path: string) { this.record(path); const value = this.files.get(path); return value === undefined ? null : { type: 'file', ctime: 1, mtime: 1, size: new TextEncoder().encode(value).byteLength }; }
  async list(path: string) {
    this.record(path);
    const prefix = path ? `${path}/` : '';
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) if (file.startsWith(prefix)) {
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) files.push(file); else folders.add(`${prefix}${rest.slice(0, slash)}`);
    }
    return { files, folders: [...folders] };
  }
}

describe('Mobile Vault-relative DataAdapter session integration', () => {
  it('runs the complete durable lifecycle without filesystem basePath authority', async () => {
    const adapter = new MemoryDataAdapter();
    const files = new ObsidianVaultFileAdapter({ vault: { adapter } } as unknown as App);
    const storage = new FileStoreSessionJsonlStorage(files);
    let sequence = 0;
    const trees = new VaultPiSessionTreeFactory(storage, { sessionId: () => `mobile-${++sequence}` });
    const store = new VaultPiSessionStore(storage, trees, { now: () => 42 });

    const created = await store.create('');
    await store.appendUserTurn(created, 'durable question');
    let tree = await trees.open(created.sessionFile);
    const userEntry = tree.getLeafId()!;
    await store.appendAgentTurn(created, [
      ...tree.loadAgentMessages(),
      { role: 'assistant', content: 'durable answer', timestamp: 2 },
    ] as Array<Record<string, unknown>>);

    expect(await store.listSessions('')).toEqual([expect.objectContaining({ sessionFile: created.sessionFile })]);
    expect((await store.openRecent(await store.open(created.sessionFile), 10)).messages.map(message => message.role))
      .toEqual(['user', 'assistant']);
    const fork = await store.fork(created, userEntry);
    expect((await store.getMessages(fork)).map(message => message.role)).toEqual(['user']);

    await store.deleteSession(created.sessionFile);
    expect(await store.listSessions('')).toEqual([expect.objectContaining({ sessionFile: fork.sessionFile })]);
    expect(adapter.files.get(created.sessionFile)).toContain('pivi/session-deleted');
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(adapter.calls.every(path => path === '.pivi' || path.startsWith('.pivi/'))).toBe(true);
  });
});
