import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const rootDir = process.cwd();
const scriptPath = join(rootDir, 'scripts/check-docs-contracts.mjs');
const manifest = JSON.parse(
  readFileSync(join(rootDir, 'docs/capabilities.json'), 'utf8'),
) as {
  mcp: { remoteOnlySince: string; supportedTransports: string[] };
};
const canonicalStatement = `Pivi supports only remote MCP servers over Streamable HTTP or SSE. Stdio MCP is not supported; this remote-only contract was introduced in v${manifest.mcp.remoteOnlySince}.`;
const canonicalDocs = [
  'README.md',
  'SECURITY.md',
  'docs/07-tools-skills-mcp-and-integrations.md',
];

function createFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-doc-contracts-'));
  mkdirSync(join(fixtureRoot, 'docs'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'docs/capabilities.json'),
    readFileSync(join(rootDir, 'docs/capabilities.json')),
  );
  for (const relativePath of canonicalDocs) {
    const filePath = join(fixtureRoot, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `# Contract\n\n${canonicalStatement}\n`);
  }
  return fixtureRoot;
}

function withFixture(callback: (fixtureRoot: string) => void) {
  const fixtureRoot = createFixture();
  try {
    callback(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function runCheck(cwd: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
  });
}

describe('check-docs-contracts', () => {
  it('passes the repository docs contracts', () => {
    expect(runCheck(rootDir).status).toBe(0);
  });

  it('runs from the combined boundary gate', () => {
    const packageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['check:docs-contracts']).toBe(
      'node scripts/check-docs-contracts.mjs',
    );
    expect(packageJson.scripts['check:boundaries']).toContain(
      'npm run check:docs-contracts',
    );
  });

  it.each([
    ['stdio-mcp', 'Stdio processes start after the first tool call.'],
    ['mcp-json-import', 'Import MCP JSON from the settings page.'],
    ['vim-mappings', 'Pivi supports Vim key mappings in the composer.'],
  ])('rejects a current claim for removed capability %s', (capability, claim) => {
    withFixture((fixtureRoot) => {
      writeFileSync(join(fixtureRoot, 'docs/current.md'), claim);

      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`removed capability ${capability} as current`);
    });
  });

  it('allows negative and compatibility statements about Stdio MCP', () => {
    withFixture((fixtureRoot) => {
      writeFileSync(
        join(fixtureRoot, 'docs/compatibility.md'),
        'Stdio MCP is not supported. Existing stdio entries are rejected on load.',
      );

      expect(runCheck(fixtureRoot).status).toBe(0);
    });
  });

  it('ignores historical changelog and archived spec claims', () => {
    withFixture((fixtureRoot) => {
      mkdirSync(join(fixtureRoot, 'specs/archive'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'CHANGELOG.md'),
        'Stdio processes start after the first tool call.',
      );
      writeFileSync(
        join(fixtureRoot, 'specs/archive/001-history.md'),
        'Import MCP JSON from the settings page. Pivi supports Vim mappings.',
      );

      expect(runCheck(fixtureRoot).status).toBe(0);
    });
  });

  it.each(canonicalDocs)('rejects canonical transport drift in %s', (relativePath) => {
    withFixture((fixtureRoot) => {
      const filePath = join(fixtureRoot, relativePath);
      writeFileSync(filePath, '# Contract\n\nPivi supports remote MCP servers.\n');

      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${relativePath} must contain the canonical MCP transport statement exactly once`,
      );
    });
  });
});
