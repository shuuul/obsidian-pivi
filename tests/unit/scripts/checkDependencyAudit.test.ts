import { execFileSync } from 'child_process';

const rootDir = process.cwd();

const PATH = 'node_modules/pkg/node_modules/brace-expansion';

function evaluate(report: unknown, allowlist: unknown, now: string): { failures: string[]; accepted: string[] } {
  const output = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { evaluateAudit } from './scripts/check-dependency-audit.mjs';
process.stdout.write(JSON.stringify(evaluateAudit(${JSON.stringify(report)}, ${JSON.stringify(allowlist)}, new Date(${JSON.stringify(now)}))));`,
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
  return JSON.parse(output) as { failures: string[]; accepted: string[] };
}

const report = {
  vulnerabilities: {
    'brace-expansion': {
      severity: 'high',
      nodes: [PATH],
      via: [{ source: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'DoS' }],
    },
    minimatch: { severity: 'high', nodes: ['node_modules/pkg/node_modules/minimatch'], via: ['brace-expansion'] },
  },
};

const entry = {
  advisory: 'GHSA-aaaa-bbbb-cccc',
  package: 'brace-expansion',
  path: PATH,
  reason: 'upstream shrinkwrap',
  expires: '2026-12-31',
};

describe('dependency audit gate', () => {
  it('accepts an allowlisted advisory at its exact path and ignores transitive entries', () => {
    const result = evaluate(report, [entry], '2026-10-01T00:00:00Z');

    expect(result.failures).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it('rejects advisories without a matching allowlist entry', () => {
    const result = evaluate(report, [{ ...entry, path: 'node_modules/brace-expansion' }], '2026-10-01T00:00:00Z');

    expect(result.failures).toEqual([
      expect.stringContaining('GHSA-aaaa-bbbb-cccc brace-expansion at node_modules/pkg/node_modules/brace-expansion'),
      expect.stringContaining('Stale allowlist entry'),
    ]);
  });

  it('rejects an expired allowlist entry', () => {
    const result = evaluate(report, [entry], '2027-01-01T00:00:00Z');

    expect(result.failures).toEqual([expect.stringContaining('allowlist entry expired on 2026-12-31')]);
  });

  it('rejects allowlist entries that no longer match any finding', () => {
    const result = evaluate({ vulnerabilities: {} }, [entry], '2026-10-01T00:00:00Z');

    expect(result.failures).toEqual([expect.stringContaining('Stale allowlist entry')]);
  });
});
