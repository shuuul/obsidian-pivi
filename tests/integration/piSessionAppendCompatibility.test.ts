import { spawnSync } from 'node:child_process';

describe('Pi session append compatibility', () => {
  it('preserves prior bytes and round-trips through the installed SessionManager', () => {
    const script = String.raw`
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { SessionManager } from '@earendil-works/pi-coding-agent';

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-pi-append-compat-'));
      try {
        const sessionDir = path.join(root, '.pivi', 'sessions');
        const manager = SessionManager.create(root, sessionDir, { id: 'append-compat' });

        // Pivi eagerly persists the header, then leaves all typed entries to
        // Pi's public append methods. These two fields are the existing narrow
        // adapter seam required to opt out of Pi's deferred first flush.
        manager._rewriteFile();
        manager.flushed = true;

        let previous = fs.readFileSync(manager.getSessionFile());
        const ids = [];
        const assertAppend = (id) => {
          const current = fs.readFileSync(manager.getSessionFile());
          if (!current.subarray(0, previous.length).equals(previous)) {
            throw new Error('append changed prior JSONL bytes');
          }
          const entry = manager.getEntry(id);
          const tail = Buffer.from(JSON.stringify(entry) + '\n');
          if (!current.subarray(previous.length).equals(tail)) {
            throw new Error('append tail differs from the manager entry');
          }
          previous = current;
          ids.push(id);
        };

        const userId = manager.appendMessage({
          role: 'user',
          content: '你好, append',
          timestamp: 1,
        });
        assertAppend(userId);
        assertAppend(manager.appendCustomEntry('pivi_session_meta', {
          title: 'Append compatibility',
          createdAt: 1,
        }));
        assertAppend(manager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'round trip' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'compat-model',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 2,
        }));
        const checkpoint = {
          piviCheckpoint: {
            schemaVersion: 1,
            continuationSummary: 'Continue from the recent request.',
            goal: 'Verify compatibility',
            constraints: [],
            decisions: ['Keep the legacy summary'],
            artifacts: [{ label: 'Spec', vaultPath: 'specs/005.md' }],
            openWork: [],
            unresolvedQuestions: [],
            nextSteps: ['Reopen the session'],
            source: {
              firstEntryId: userId,
              lastEntryId: userId,
              firstKeptEntryId: userId,
            },
            tokenEstimates: { contextBefore: 2, checkpoint: 20 },
          },
        };
        const compactionId = manager.appendCompaction(
          'Earlier context.',
          userId,
          2,
          checkpoint,
        );
        assertAppend(compactionId);

        const reopened = SessionManager.open(manager.getSessionFile(), sessionDir, root);
        const reopenedEntries = reopened.getEntries();
        if (JSON.stringify(reopenedEntries) !== JSON.stringify(manager.getEntries())) {
          throw new Error('reopened entries differ from appended entries');
        }
        if (reopened.getLeafId() !== ids.at(-1)) {
          throw new Error('reopened leaf differs from the appended leaf');
        }
        if (JSON.stringify(reopened.getEntry(compactionId)?.details) !== JSON.stringify(checkpoint)) {
          throw new Error('reopened compaction details differ from the appended checkpoint');
        }
        const context = JSON.stringify(reopened.buildSessionContext());
        if (!context.includes('Earlier context.')
          || context.includes('Append compatibility')
          || context.includes('Verify compatibility')) {
          throw new Error('reopened context has incorrect custom/compaction semantics');
        }
        console.log(JSON.stringify({ entries: reopenedEntries.length, bytes: previous.length }));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      entries: 4,
      bytes: expect.any(Number),
    });
  });
});
