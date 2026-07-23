import {
  buildHighRiskGrantKey,
  fingerprintResources,
  HighRiskApprovalController,
  HighRiskDeniedError,
  isGrantNarrowerOrEqual,
  MemoryHighRiskAuditSink,
  classifyHighRiskToolCall,
  HIGH_RISK_BULK_CHILD_THRESHOLD,
} from '@pivi/pivi-agent-core/runtime/highRisk';

describe('high-risk approval controller', () => {
  it('binds grants to session, turn, kind, and resource fingerprint', async () => {
    const presented: unknown[] = [];
    const controller = new HighRiskApprovalController({
      presenter: {
        async present(request) {
          presented.push(request);
          return 'approve';
        },
      },
    });
    controller.beginTurn('session-a', 'turn-1');
    await controller.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['Notes/a.md'] },
      toolName: 'obsidian_delete',
    });
    expect(presented).toHaveLength(1);

    // Same args reuse grant without a second prompt.
    await controller.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['Notes/a.md'] },
      toolName: 'obsidian_delete',
    });
    expect(presented).toHaveLength(1);

    // Argument change requires a new confirmation.
    await controller.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['Notes/b.md'] },
      toolName: 'obsidian_delete',
    });
    expect(presented).toHaveLength(2);
  });

  it('invalidates pending and granted approvals on lifecycle changes', async () => {
    const controller = new HighRiskApprovalController({
      presenter: {
        present: () => new Promise(() => {
          // Never resolves; invalidation must fail closed.
        }),
      },
      timeoutMs: 30_000,
    });
    controller.beginTurn('session-a', 'turn-1');
    const pending = controller.authorize({
      kind: 'bash',
      resources: { executable: 'pwd' },
    });
    controller.invalidate('invalidated');
    await expect(pending).resolves.toMatchObject({ outcome: 'invalidated' });
  });

  it('denies subagent requests outside inherited parent grants without presenting UI', async () => {
    let presented = 0;
    const parent = new HighRiskApprovalController({
      presenter: {
        async present() {
          presented += 1;
          return 'approve';
        },
      },
    });
    parent.beginTurn('session-a', 'turn-1');
    await parent.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['a.md'] },
    });

    const child = new HighRiskApprovalController({
      presenter: {
        async present() {
          presented += 1;
          return 'approve';
        },
      },
    });
    child.setMode('inherit-only');
    child.beginTurn('session-a', 'subagent-1');
    child.setParentGrants(parent.snapshotGrants());

    await child.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['a.md'] },
    });
    await expect(child.requireAuthorized({
      kind: 'delete',
      resources: { paths: ['b.md'] },
    })).rejects.toBeInstanceOf(HighRiskDeniedError);
    expect(presented).toBe(1);
  });

  it('records metadata-only audit entries under retention limits', async () => {
    const audit = new MemoryHighRiskAuditSink(2, 10_000);
    const controller = new HighRiskApprovalController({
      audit,
      presenter: {
        async present() {
          return 'deny';
        },
      },
    });
    controller.beginTurn('session-a', 'turn-1');
    await controller.authorize({ kind: 'eval', resources: { executable: 'obsidian-cli-eval' } });
    await controller.authorize({ kind: 'bash', resources: { executable: 'pwd' } });
    await controller.authorize({ kind: 'delete', resources: { paths: ['x.md'] } });
    expect(audit.list()).toHaveLength(2);
    for (const entry of audit.list()) {
      expect(JSON.stringify(entry)).not.toMatch(/password|token|secret|content|body/i);
    }
  });
});

describe('high-risk classification', () => {
  it('classifies overwrite of an existing file and bulk folder deletes', async () => {
    const overwrite = await classifyHighRiskToolCall(
      'obsidian_write',
      { path: 'note.md', mode: 'overwrite', content: 'x' },
      { pathExists: () => true },
    );
    expect(overwrite?.kind).toBe('overwrite');

    const bulk = await classifyHighRiskToolCall(
      'obsidian_delete',
      { path: 'folder' },
      { folderChildCount: () => HIGH_RISK_BULK_CHILD_THRESHOLD + 1 },
    );
    expect(bulk?.kind).toBe('bulk-mutation');
    expect(bulk?.resources.bulkCount).toBe(HIGH_RISK_BULK_CHILD_THRESHOLD + 1);
  });

  it('classifies explicit overwrite intent without consulting path existence', async () => {
    const pathExists = jest.fn(() => false);
    await expect(classifyHighRiskToolCall(
      'obsidian_write',
      { path: 'new.md', mode: 'overwrite' },
      { pathExists },
    )).resolves.toMatchObject({ kind: 'overwrite' });
    await expect(classifyHighRiskToolCall(
      'obsidian_write',
      { path: 'new.md', mode: 'create', overwrite: true },
      { pathExists },
    )).resolves.toMatchObject({ kind: 'overwrite' });
    expect(pathExists).not.toHaveBeenCalled();
  });

  it('fingerprints Bash using the same quote-aware argv that execution uses', async () => {
    const classification = await classifyHighRiskToolCall(
      'obsidian_bash',
      { command: `echo "a b" 'c d'` },
    );
    expect(classification?.resources).toMatchObject({
      executable: 'echo',
      args: ['a b', 'c d'],
    });
  });

  it('builds stable grant keys from normalized resources', () => {
    const keyA = buildHighRiskGrantKey('s', 't', 'delete', { paths: ['B.md', 'A.md'] });
    const keyB = buildHighRiskGrantKey('s', 't', 'delete', { paths: ['A.md', 'B.md'] });
    expect(keyA).toBe(keyB);
    expect(fingerprintResources({ paths: ['A.md'] })).not.toBe(fingerprintResources({ paths: ['B.md'] }));
    expect(isGrantNarrowerOrEqual({ paths: ['a.md', 'b.md'] }, { paths: ['a.md'] })).toBe(true);
    expect(isGrantNarrowerOrEqual({ paths: ['a.md'] }, { paths: ['b.md'] })).toBe(false);
  });
});
