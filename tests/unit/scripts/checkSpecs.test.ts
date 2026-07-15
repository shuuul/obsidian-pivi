import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = process.cwd();
const scriptPath = join(rootDir, 'scripts/check-specs.mjs');
const requiredSections = [
  'Context',
  'Goal and success criteria',
  'Scope and non-goals',
  'Decisions',
  'Workstreams',
  'Verification',
  'Documentation sync',
  'Progress and handoff',
  'Completion summary',
];

function templateContents() {
  return `---
id: "NNN"
title: "Spec title"
status: Draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
coordinator: "Coordinator"
---

# Template

${requiredSections.map((heading) => `## ${heading}\n\nPlaceholder.`).join('\n\n')}
`;
}

function specContents({
  id,
  status,
  title = `Spec ${id}`,
  created = '2026-07-15',
  updated = created,
  sections = requiredSections,
}: {
  id: string;
  status: 'Draft' | 'Active' | 'Completed';
  title?: string;
  created?: string;
  updated?: string;
  sections?: string[];
}) {
  return `---
id: "${id}"
title: "${title}"
status: ${status}
created: ${created}
updated: ${updated}
coordinator: "Coordinator"
---

# ${id} — ${title}

${sections.map((heading) => `## ${heading}\n\nContent.`).join('\n\n')}
`;
}

function indexContents(active: string[] = [], archived: string[] = []) {
  const rows = (links: string[]) => links
    .map((link) => `| [${link}](${link}) | Status | Summary |`)
    .join('\n');
  return `# Specs

Copy [the template](000-template.md).

## Active specs

| Spec | Status | Summary |
|---|---|---|
${rows(active)}

## Archived specs

| Spec | Completed | Outcome |
|---|---|---|
${rows(archived)}
`;
}

function createFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-specs-'));
  mkdirSync(join(fixtureRoot, 'specs/archive'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'specs/000-template.md'), templateContents());
  writeFileSync(join(fixtureRoot, 'specs/README.md'), indexContents());
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

function runCheck(fixtureRoot: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
}

function writeSpec(
  fixtureRoot: string,
  relativePath: string,
  options: Parameters<typeof specContents>[0],
) {
  writeFileSync(join(fixtureRoot, 'specs', relativePath), specContents(options));
}

describe('check-specs', () => {
  it('passes the repository specs system', () => {
    expect(runCheck(rootDir).status).toBe(0);
  });

  it('accepts an empty index with the template', () => {
    withFixture((fixtureRoot) => {
      expect(runCheck(fixtureRoot).status).toBe(0);
    });
  });

  it('accepts indexed active and completed specs', () => {
    withFixture((fixtureRoot) => {
      writeSpec(fixtureRoot, '001-active-work.md', { id: '001', status: 'Active' });
      writeSpec(fixtureRoot, 'archive/002-finished-work.md', {
        id: '002',
        status: 'Completed',
      });
      writeFileSync(
        join(fixtureRoot, 'specs/README.md'),
        indexContents(['001-active-work.md'], ['archive/002-finished-work.md']),
      );

      expect(runCheck(fixtureRoot).status).toBe(0);
    });
  });

  it.each([
    ['invalid filename', '01-invalid.md', { id: '001', status: 'Draft' as const }],
    ['reserved formal ID', '000-not-a-spec.md', { id: '000', status: 'Draft' as const }],
    ['metadata mismatch', '001-mismatch.md', { id: '002', status: 'Draft' as const }],
    ['completed active spec', '001-completed.md', { id: '001', status: 'Completed' as const }],
  ])('rejects %s', (_name, relativePath, options) => {
    withFixture((fixtureRoot) => {
      writeSpec(fixtureRoot, relativePath, options);
      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Specs check failed:');
    });
  });

  it('rejects duplicate IDs across active and archive', () => {
    withFixture((fixtureRoot) => {
      writeSpec(fixtureRoot, '001-active.md', { id: '001', status: 'Active' });
      writeSpec(fixtureRoot, 'archive/001-finished.md', { id: '001', status: 'Completed' });

      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('spec ID 001 is duplicated');
    });
  });

  it('rejects missing real headings and invalid dates', () => {
    withFixture((fixtureRoot) => {
      writeSpec(fixtureRoot, '001-invalid-structure.md', {
        id: '001',
        status: 'Draft',
        created: '2026-02-30',
        updated: '2026-02-01',
        sections: requiredSections.filter((heading) => heading !== 'Verification'),
      });
      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('must contain ## Verification exactly once');
      expect(result.stderr).toContain('created must be a real YYYY-MM-DD date');
    });
  });

  it('rejects structured frontmatter values', () => {
    withFixture((fixtureRoot) => {
      const filePath = join(fixtureRoot, 'specs/001-structured-metadata.md');
      const contents = specContents({ id: '001', status: 'Draft' })
        .replace('coordinator: "Coordinator"', 'coordinator: [agent-one, agent-two]');
      writeFileSync(filePath, contents);

      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('must use a flat scalar, not structured YAML');
    });
  });

  it.each([
    ['missing link', indexContents()],
    [
      'duplicate link',
      indexContents(['001-first.md', '001-first.md', '002-second.md']),
    ],
    [
      'wrong section',
      indexContents(['002-second.md'], ['001-first.md']),
    ],
    [
      'out-of-order links',
      indexContents(['002-second.md', '001-first.md']),
    ],
  ])('rejects an index with a %s', (_name, readme) => {
    withFixture((fixtureRoot) => {
      writeSpec(fixtureRoot, '001-first.md', { id: '001', status: 'Draft' });
      writeSpec(fixtureRoot, '002-second.md', { id: '002', status: 'Active' });
      writeFileSync(join(fixtureRoot, 'specs/README.md'), readme);

      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Specs check failed:');
    });
  });
});
