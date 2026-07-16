import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

interface FixtureEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  version?: number;
  cwd?: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  customType?: string;
  data?: {
    contentBlocks?: unknown[];
    toolCalls?: unknown[];
  };
}

const rootDir = process.cwd();
const scriptPath = join(rootDir, 'scripts/generate-perf-sessions.mjs');
const fixtureFiles = [
  'perf-001-1k-messages.jsonl',
  'perf-002-5k-messages.jsonl',
  'perf-003-100kb-markdown.jsonl',
  'perf-004-20-subagents.jsonl',
];

function readEntries(filePath: string): FixtureEntry[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FixtureEntry);
}

function expectLinearSession(entries: FixtureEntry[], vaultPath: string) {
  expect(entries[0]).toMatchObject({
    type: 'session',
    version: 3,
    cwd: vaultPath,
  });
  let parentId: string | null = null;
  for (const entry of entries.slice(1)) {
    expect(entry.parentId).toBe(parentId);
    expect(entry.id).toBeDefined();
    parentId = entry.id ?? null;
  }
}

describe('generate-perf-sessions', () => {
  const vaultPath = mkdtempSync(join(tmpdir(), 'pivi-perf-sessions-'));
  const sessionsDirectory = join(vaultPath, '.pivi', 'sessions');

  afterAll(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it('generates deterministic Pi-compatible performance sessions', () => {
    const generated = spawnSync(process.execPath, [scriptPath, vaultPath], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(generated.status).toBe(0);
    expect(generated.stdout).toContain('Generated 4 performance sessions');

    const sessions = fixtureFiles.map((fileName) => {
      const filePath = join(sessionsDirectory, fileName);
      const entries = readEntries(filePath);
      expectLinearSession(entries, vaultPath);
      return { filePath, entries };
    });
    const [oneThousand, fiveThousand, markdown, subagents] = sessions;
    if (!oneThousand || !fiveThousand || !markdown || !subagents) {
      throw new Error('Expected all four performance fixtures');
    }

    expect(oneThousand.entries.filter((entry) => entry.type === 'message')).toHaveLength(1_000);
    expect(fiveThousand.entries.filter((entry) => entry.type === 'message')).toHaveLength(5_000);

    const markdownEntry = markdown.entries.find((entry) => entry.id === 'markdown-assistant');
    const markdownContent = markdownEntry?.message?.content;
    expect(Array.isArray(markdownContent)).toBe(true);
    const markdownText = Array.isArray(markdownContent) ? markdownContent[0]?.text : undefined;
    expect(Buffer.byteLength(markdownText ?? '', 'utf8')).toBe(100 * 1024);

    const agentOverlay = subagents.entries.find(
      (entry) => entry.customType === 'pivi/message-ui',
    );
    expect(agentOverlay?.data?.contentBlocks).toHaveLength(21);
    expect(agentOverlay?.data?.toolCalls).toHaveLength(20);

    const compatibilityCheck = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import { SessionManager } from '@earendil-works/pi-coding-agent';",
        "import { dirname } from 'node:path';",
        'const [vault, ...files] = process.argv.slice(1);',
        'for (const file of files) {',
        '  const manager = SessionManager.open(file, dirname(file), vault);',
        '  if (manager.getBranch().length === 0) process.exit(2);',
        '}',
      ].join('\n'),
      vaultPath,
      ...sessions.map(({ filePath }) => filePath),
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(compatibilityCheck.stderr).toBe('');
    expect(compatibilityCheck.status).toBe(0);
  });

  it('rejects a missing vault path', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: dirname(scriptPath),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: node scripts/generate-perf-sessions.mjs <vault>');
  });
});
