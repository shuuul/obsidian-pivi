import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts/smoke-obsidian.mjs');
const cliDouble = join(process.cwd(), 'tests/helpers/smokeObsidianCli.cjs');

function runFixture(scenario: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pivi-smoke-test-')));
  const vault = join(root, 'vault');
  const other = join(root, 'other');
  mkdirSync(join(vault, '.pivi/sessions'), { recursive: true });
  mkdirSync(join(vault, '.pivi-smoke'));
  mkdirSync(other);
  writeFileSync(join(vault, '.pivi-smoke/user.md'), 'user-owned');
  try {
    const result = spawnSync(process.execPath, ['--require', cliDouble, script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OBSIDIAN_VAULT: vault,
        SMOKE_CASE: scenario,
        SMOKE_OTHER: other,
        SMOKE_STATE: join(root, 'state.json'),
        SMOKE_CALLS: join(root, 'calls.jsonl'),
      },
      timeout: 20_000,
    });
    const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { args: string[]; cwd: string; timeout: number });
    return {
      ...result, calls, vault,
      notes: readdirSync(join(vault, '.pivi-smoke')),
      sessions: readdirSync(join(vault, '.pivi/sessions')),
      other: readdirSync(other),
      user: readFileSync(join(vault, '.pivi-smoke/user.md'), 'utf8'),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('real-host smoke safety (CLI double, not real-host acceptance)', () => {
  it('looks up the registered Pivi view type', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain("getLeavesOfType('pivi-view')");
    expect(source).not.toContain("getLeavesOfType('pivi-chat')");
  });

  it('rejects a wrong vault before reload or fixture mutation', () => {
    const result = runFixture('wrong-vault');
    expect(result.status).toBe(1);
    expect(result.calls.some(call => call.args.includes('plugin:reload'))).toBe(false);
    expect(result.notes).toEqual(['user.md']);
    expect(result.sessions).toEqual([]);
    expect(result.other).toEqual([]);
    expect(result.stderr).toContain('Smoke vault mismatch');
  });

  it('rejects a production or stale build before fixture mutation', () => {
    const result = runFixture('current-shell');
    expect(result.status).toBe(1);
    expect(result.notes).toEqual(['user.md']);
    expect(result.sessions).toEqual([]);
    expect(result.other).toEqual([]);
    expect(result.stderr).toContain('Development smoke harness unavailable');
  });

  it('targets the configured vault and applies a finite CLI timeout', () => {
    const result = runFixture('success');
    expect(result.calls[0]?.args).toEqual(['vault=vault', 'help']);
    for (const call of result.calls) {
      expect(call.cwd).toBe(result.vault);
      expect(call.timeout).toBe(30_000);
      expect(call.args[0]).toBe('vault=vault');
    }
  });

  it('detects a same-name replacement using the retained function reference', () => {
    const result = runFixture('fetch-replacement');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('window.fetch identity changed');
    expect(result.calls.at(-1)?.args.join(' ')).toContain('delete window[');
    expect(result.notes).toEqual(['user.md']);
  });

  it.each(['success', 'write-failure', 'restore-failure'])('cleans owned fixtures on %s without deleting user data', scenario => {
    const result = runFixture(scenario);
    expect(result.status).toBe(scenario === 'success' ? 0 : 1);
    expect(result.notes).toEqual(['user.md']);
    expect(result.sessions).toEqual([]);
    expect(result.user).toBe('user-owned');
    expect(result.calls.at(-1)?.args.join(' ')).toContain('delete window[');
  });

  it('reports the primary failure and continues sibling cleanup after remove fails', () => {
    const result = runFixture('cleanup-failure');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected cleanup failure');
    expect(result.stderr).toContain('Cleanup failed for real-host smoke resources');
    expect(result.sessions).toEqual([]);
    expect(result.notes).toHaveLength(3);
    expect(result.user).toBe('user-owned');
  });

  it('reports a CLI timeout rather than proceeding after an unknown result', () => {
    const result = runFixture('timeout');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ETIMEDOUT');
    expect(result.calls).toHaveLength(1);
    expect(result.notes).toEqual(['user.md']);
  });

  it('retains an ownership ledger instead of racing cleanup after a turn timeout', () => {
    const result = runFixture('turn-timeout');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ETIMEDOUT');
    expect(result.stderr).toContain('retained ownership ledger for retry');
    expect(result.notes).toHaveLength(3);
    expect(result.sessions).toHaveLength(1);
    expect(result.user).toBe('user-owned');
  });
});
