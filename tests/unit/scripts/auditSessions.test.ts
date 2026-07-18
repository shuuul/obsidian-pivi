import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = process.cwd();
const scriptPath = join(rootDir, 'scripts/audit-sessions.mjs');

function entry(value: unknown): string {
  return JSON.stringify(value);
}

describe('audit-sessions', () => {
  const vaultPath = mkdtempSync(join(tmpdir(), 'pivi-audit-sessions-'));
  const sessionsDirectory = join(vaultPath, '.pivi', 'sessions');

  beforeAll(() => {
    mkdirSync(sessionsDirectory, { recursive: true });
    const realEntries = [
      entry({ type: 'session', id: 'session-1' }),
      entry({ type: 'message', message: { role: 'user', content: 'PRIVATE_USER_TEXT' } }),
      entry({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            name: 'obsidian_bash',
            arguments: { command: 'PRIVATE_COMMAND' },
          }],
        },
      }),
      entry({
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'obsidian_bash',
          isError: true,
          content: [{ type: 'text', text: 'Bash command must not contain shell control syntax' }],
        },
      }),
      entry({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            name: 'obsidian_bash',
            arguments: { command: 'PRIVATE_COMMAND' },
          }],
        },
      }),
      entry({
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'obsidian_search',
          isError: false,
          content: [{ type: 'text', text: 'x'.repeat(100_100) }],
        },
      }),
      ...Array.from({ length: 21 }, (_, index) => entry({
        type: 'custom',
        customType: 'pivi/message-ui',
        id: `overlay-${index}`,
        data: { targetEntryId: 'private-target', displayContent: `private-${index}` },
      })),
      '\0'.repeat(32),
    ];
    writeFileSync(join(sessionsDirectory, 'real-session.jsonl'), `${realEntries.join('\n')}\n`);
    writeFileSync(join(sessionsDirectory, 'perf-001-test.jsonl'), [
      entry({ type: 'session', id: 'perf' }),
      entry({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'perf_private_tool', arguments: {} }],
        },
      }),
    ].join('\n'));
  });

  afterAll(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it('reports aggregate findings without exposing session content or tool arguments', () => {
    const result = spawnSync(process.execPath, [scriptPath, vaultPath, '--json'], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      totals: Record<string, number>;
      tools: Array<Record<string, unknown>>;
      bash: Record<string, number>;
      findings: Record<string, Array<Record<string, unknown>>>;
    };
    expect(report.totals).toMatchObject({
      files: 2,
      realSessions: 1,
      performanceFixtures: 1,
      malformedLines: 1,
    });
    expect(report.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'obsidian_bash',
        calls: 2,
        results: 1,
        errors: 1,
        repeatedExactCalls: 1,
      }),
    ]));
    expect(report.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'perf_private_tool' }),
    ]));
    expect(report.bash).toMatchObject({
      calls: 2,
      errors: 1,
      policyRejections: 1,
      retriesAfterPolicyRejection: 1,
    });
    expect(report.findings.malformedLines).toEqual([
      expect.objectContaining({ file: 'real-session.jsonl', containsNul: true }),
    ]);
    expect(report.findings.oversizedToolResults).toEqual([
      expect.objectContaining({ file: 'real-session.jsonl', tool: 'obsidian_search' }),
    ]);
    expect(report.findings.overlayAmplification).toEqual([
      expect.objectContaining({ file: 'real-session.jsonl', maximumEntriesPerTarget: 21 }),
    ]);
    expect(result.stdout).not.toContain('PRIVATE_USER_TEXT');
    expect(result.stdout).not.toContain('PRIVATE_COMMAND');
    expect(result.stdout).not.toContain('private-target');
  });

  it('prints a concise human-readable report and treats findings as diagnostics', () => {
    const result = spawnSync(process.execPath, [scriptPath, sessionsDirectory], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Pivi session audit');
    expect(result.stdout).toContain('Sessions: 2 (1 real, 1 perf)');
    expect(result.stdout).toContain('Malformed lines: 1');
    expect(result.stdout).not.toContain('PRIVATE_USER_TEXT');
  });

  it('rejects missing or unreadable input paths', () => {
    const missing = spawnSync(process.execPath, [scriptPath], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Usage: node scripts/audit-sessions.mjs');

    const unreadable = spawnSync(process.execPath, [scriptPath, join(vaultPath, 'missing')], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(unreadable.status).toBe(1);
    expect(unreadable.stderr).toContain('Sessions directory is not readable');
  });
});
