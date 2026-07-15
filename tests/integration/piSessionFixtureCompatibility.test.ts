import { spawnSync } from 'node:child_process';

describe('frozen Pi session fixture compatibility', () => {
  it('opens old and mixed checkpoint shapes idempotently with the installed Pi runtime', () => {
    const script = String.raw`
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { SessionManager } from '@earendil-works/pi-coding-agent';

      const fixtures = path.join(process.cwd(), 'tests', 'fixtures', 'sessions');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-fixtures-'));
      const sessionDir = path.join(root, '.pivi', 'sessions');
      fs.mkdirSync(sessionDir, { recursive: true });

      const openTwice = (fixtureName) => {
        const source = path.join(fixtures, fixtureName);
        const target = path.join(sessionDir, fixtureName);
        fs.copyFileSync(source, target);
        const sourceBytes = fs.readFileSync(target);
        const first = SessionManager.open(target, sessionDir, root);
        const afterFirstOpen = fs.readFileSync(target);
        const firstEntries = first.getEntries();
        const firstContext = first.buildSessionContext();
        const second = SessionManager.open(target, sessionDir, root);
        const afterSecondOpen = fs.readFileSync(target);
        if (!afterSecondOpen.equals(afterFirstOpen)) {
          throw new Error(fixtureName + ' changed on idempotent reopen');
        }
        if (JSON.stringify(second.getEntries()) !== JSON.stringify(firstEntries)) {
          throw new Error(fixtureName + ' entries changed on reopen');
        }
        return {
          sourceBytes,
          afterFirstOpen,
          manager: second,
          entries: firstEntries,
          context: firstContext,
        };
      };

      const assertExactFork = (fixtureName, opened) => {
        const forkPath = opened.manager.createBranchedSession(opened.manager.getLeafId());
        if (!forkPath) {
          throw new Error(fixtureName + ' did not create a fork');
        }
        const forked = SessionManager.open(forkPath, sessionDir, root);
        if (JSON.stringify(forked.getEntries()) !== JSON.stringify(opened.entries)
          || JSON.stringify(forked.buildSessionContext()) !== JSON.stringify(opened.context)) {
          throw new Error(fixtureName + ' exact fork changed entries or context');
        }
      };

      try {
        const legacy = openTwice('pre-change-v3-compaction.jsonl');
        if (!legacy.sourceBytes.equals(legacy.afterFirstOpen)) {
          throw new Error('pre-change v3 fixture was unexpectedly rewritten');
        }
        const legacyContext = JSON.stringify(legacy.context);
        if (!legacyContext.includes('Legacy summary without structured details.')
          || !legacyContext.includes('Kept request')) {
          throw new Error('pre-change v3 context did not resume');
        }
        assertExactFork('pre-change v3', legacy);

        const mixed = openTwice('mixed-checkpoint-chain-v3.jsonl');
        if (!mixed.sourceBytes.equals(mixed.afterFirstOpen)) {
          throw new Error('mixed v3 fixture was unexpectedly rewritten');
        }
        const compactions = mixed.entries.filter((entry) => entry.type === 'compaction');
        if (compactions.length !== 2
          || compactions[0].details !== undefined
          || compactions[1].details?.piviCheckpoint?.schemaVersion !== 1) {
          throw new Error('mixed checkpoint details were not preserved');
        }
        const mixedContext = JSON.stringify(mixed.context);
        if (!mixedContext.includes('Latest readable checkpoint summary.')
          || !mixedContext.includes('Latest kept request')
          || mixedContext.includes('Earlier legacy checkpoint summary.')
          || mixedContext.includes('Verify mixed checkpoint compatibility')) {
          throw new Error('mixed checkpoint context semantics changed');
        }
        assertExactFork('mixed checkpoint chain', mixed);

        const migrated = openTwice('legacy-v1-compaction-shape.jsonl');
        if (migrated.sourceBytes.equals(migrated.afterFirstOpen)) {
          throw new Error('legacy v1 fixture did not migrate');
        }
        const header = JSON.parse(migrated.afterFirstOpen.toString('utf8').split('\n')[0]);
        const migratedCompaction = migrated.entries.find((entry) => entry.type === 'compaction');
        if (header?.version !== 3
          || typeof migratedCompaction?.firstKeptEntryId !== 'string'
          || 'firstKeptEntryIndex' in migratedCompaction) {
          throw new Error('legacy v1 fixture migration is incomplete');
        }
        const migratedContext = JSON.stringify(migrated.context);
        if (!migratedContext.includes('Migrated v1 summary.')
          || !migratedContext.includes('Legacy kept request')) {
          throw new Error('migrated v1 context did not resume');
        }
        assertExactFork('migrated v1', migrated);

        console.log(JSON.stringify({
          legacyEntries: legacy.entries.length,
          mixedCompactions: compactions.length,
          migratedVersion: header.version,
        }));
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
          legacyEntries: 4,
      mixedCompactions: 2,
      migratedVersion: 3,
    });
  });
});
