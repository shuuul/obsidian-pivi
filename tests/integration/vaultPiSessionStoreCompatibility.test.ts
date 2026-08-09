import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SessionContentRevision, SessionJsonlSnapshot, SessionJsonlStorage } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import { VaultPiSessionStore } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionStore';
import { VaultPiSessionTreeFactory } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree';

class BytesStorage implements SessionJsonlStorage {
  files = new Map<string, string>();
  async list() { return [...this.files.keys()].map(path => ({ path })); }
  async read(path: string) { const content = this.files.get(path); if (content === undefined) throw new Error('missing'); return this.snap(path, content); }
  async create(path: string, content: string) { this.files.set(path, content); return this.read(path); }
  async append(path: string, content: string, expected: SessionContentRevision) { const before = await this.read(path); if (before.revision.sha256 !== expected.sha256) throw new Error('stale'); this.files.set(path, before.content + content); return this.read(path); }
  async replace(path: string, content: string) { this.files.set(path, content); return this.read(path); }
  async delete(path: string) { this.files.delete(path); }
  private snap(path: string, content: string): SessionJsonlSnapshot { return { path, content, revision: { bytes: Buffer.byteLength(content), sha256: content } }; }
}

describe('Vault Pi store pinned Desktop compatibility', () => {
  it('opens a frozen Desktop fixture, appends/forks it, and emits Desktop-accepted bytes; Mobile creation also opens on Desktop', async () => {
    const storage = new BytesStorage();
    const fixturePath = '.pivi/sessions/desktop-fixture.jsonl';
    storage.files.set(fixturePath, fs.readFileSync('tests/fixtures/sessions/pre-change-v3-compaction.jsonl', 'utf8'));
    let session = 0;
    const factory = new VaultPiSessionTreeFactory(storage, { sessionId: () => `mobile-${++session}` });
    const store = new VaultPiSessionStore(storage, factory);
    const desktop = await store.open(fixturePath);
    await store.appendUserTurn(desktop, 'Mobile continuation');
    const tree = await factory.open(fixturePath);
    await store.appendAgentTurn(desktop, [
      ...tree.loadAgentMessages(),
      { role: 'assistant', content: 'Mobile answer', timestamp: 3 },
    ] as Array<Record<string, unknown>>);
    const appended = await factory.open(fixturePath);
    const fork = await store.fork(desktop, appended.getLeafId()!);
    const mobile = await store.create('');
    await store.appendUserTurn(mobile, 'Created on Mobile');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-vault-compat-'));
    try {
      const outputs = [desktop.sessionFile, fork.sessionFile, mobile.sessionFile].map((source, index) => {
        const target = path.join(root, `${index}.jsonl`);
        fs.writeFileSync(target, storage.files.get(source)!);
        return target;
      });
      const script = String.raw`
        import { SessionManager } from '@earendil-works/pi-coding-agent';
        const [root, ...files] = process.argv.slice(1);
        const result = files.map(file => {
          const manager = SessionManager.open(file, root, root);
          return { id: manager.getSessionId(), entries: manager.getEntries().length,
            context: JSON.stringify(manager.buildSessionContext()) };
        });
        if (!result[0].context.includes('Mobile answer')) throw new Error('Desktop rejected appended continuation');
        if (!result[2].context.includes('Created on Mobile')) throw new Error('Desktop rejected Mobile-created session');
        console.log(JSON.stringify(result.map(value => ({ id: value.id, entries: value.entries }))));
      `;
      const accepted = JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', script, root, ...outputs],
        { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } }));
      expect(accepted).toEqual([
        expect.objectContaining({ entries: expect.any(Number) }),
        expect.objectContaining({ entries: expect.any(Number) }),
        expect.objectContaining({ id: expect.stringMatching(/^mobile-/), entries: expect.any(Number) }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
