import { execFileSync } from 'node:child_process';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { PiSessionJsonlDocument } from '@pivi/pivi-agent-core/engine/pi/session/piSessionJsonlDocument';

describe('PiSessionJsonlDocument pinned Pi differential compatibility', () => {
  it('matches append record bytes and fork branch semantics', () => {
    const script = String.raw`
      import { SessionManager } from '@earendil-works/pi-coding-agent';
      const manager = SessionManager.inMemory('/vault', { id: 'session-1' });
      const ids = [];
      ids.push(manager.appendMessage({ role: 'user', content: [{ type: 'text', text: '你好 👋' }, { type: 'image', data: 'AQID', mimeType: 'image/png' }], timestamp: 42 }));
      ids.push(manager.appendCustomEntry('plugin/state', { emoji: '🧭' }));
      ids.push(manager.appendCompaction('摘要', ids[0], 123, { checkpoint: true }));
      const entries = ids.map(id => manager.getEntry(id));
      console.log(JSON.stringify({ header: manager.getHeader(), entries, branch: manager.getBranch(ids[2]) }));
    `;
    const real = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' },
    })) as { header: Record<string, unknown>; entries: Array<Record<string, unknown>>; branch: Array<Record<string, unknown>> };
    let idIndex = 0;
    let timeIndex = 0;
    const document = PiSessionJsonlDocument.parse(`${JSON.stringify(real.header)}\n`, {
      entryId: () => real.entries[idIndex++]!.id as string,
      now: () => (real.entries[timeIndex++]?.timestamp ?? '2026-01-01T00:00:00.000Z') as string,
      sessionId: () => 'fork-id',
    });

    const plans = [
      document.planUserMessage([
        { type: 'text', text: '你好 👋' },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ], 42),
    ];
    document.apply(plans[0]!);
    plans.push(document.planCustom('plugin/state', { emoji: '🧭' }));
    document.apply(plans[1]!);
    plans.push(document.planCompaction('摘要', real.entries[0]!.id as string, 123, { checkpoint: true }));
    document.apply(plans[2]!);

    expect(plans.map(plan => plan.appendBytes)).toEqual(
      real.entries.map(entry => `${JSON.stringify(entry)}\n`),
    );
    expect(document.getBranch()).toEqual(real.branch);
    const fork = document.planFork(real.entries[2]!.id as string, '/vault', 'source.jsonl');
    expect(fork.entries).toEqual(real.branch.map((entry, index) => ({
      ...entry, parentId: index === 0 ? null : real.branch[index - 1]!.id,
    })));
  });
});
