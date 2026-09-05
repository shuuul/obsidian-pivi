import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  expandSkillSupportingPaths,
  formatSkillToolBlock,
} from '@pivi/agent/skills/vault/expandSkillSupportingPaths';

describe('expandSkillSupportingPaths', () => {
  let skillDir: string;

  beforeEach(() => {
    skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-expand-skill-'));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill\n');
    fs.mkdirSync(path.join(skillDir, 'references'));
    fs.writeFileSync(path.join(skillDir, 'references', 'syntax.md'), '# Syntax\n');
    fs.mkdirSync(path.join(skillDir, 'scripts'));
    fs.writeFileSync(path.join(skillDir, 'scripts', 'update-references.py'), '# script\n');
  });

  afterEach(() => {
    fs.rmSync(skillDir, { recursive: true, force: true });
  });

  it('rewrites existing relative paths to absolute and marks missing skill-relative files', () => {
    const syntaxPath = path.join(skillDir, 'references', 'syntax.md');
    const body = [
      '1. Read `docs/marp-extended-syntax.md` first.',
      '2. Read `references/syntax.md` next.',
      '3. See `@marp-team/marp-core` `5.0.1`.',
      '4. Also [syntax](references/syntax.md).',
    ].join('\n');

    const expanded = expandSkillSupportingPaths({ body, absoluteBaseDir: skillDir });

    expect(expanded.body).toContain(`\`${syntaxPath}\``);
    expect(expanded.body).toContain(`[syntax](${syntaxPath})`);
    expect(expanded.body).toContain('docs/marp-extended-syntax.md (not in this skill; do not read)');
    expect(expanded.body).not.toContain('`docs/marp-extended-syntax.md`');
    expect(expanded.body).toContain('`@marp-team/marp-core`');
    expect(expanded.body).toContain('`5.0.1`');
    expect(expanded.presentPaths).toEqual([syntaxPath]);
    expect(expanded.missingPaths).toEqual(['docs/marp-extended-syntax.md']);
    expect(expanded.rootEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['SKILL.md', 'references', 'scripts']),
    );
    expect(expanded.rootEntries).toHaveLength(3);
  });

  it('does not rewrite paths that escape the skill directory', () => {
    const body = 'Do not read `../../etc/passwd`.';
    const expanded = expandSkillSupportingPaths({ body, absoluteBaseDir: skillDir });
    expect(expanded.body).toBe(body);
    expect(expanded.presentPaths).toEqual([]);
    expect(expanded.missingPaths).toEqual([]);
  });

  it('marks referenced files missing when the skill directory does not exist', () => {
    const missingDir = path.join(skillDir, 'missing-skill');
    const body = 'Read `references/syntax.md`.';
    const expanded = expandSkillSupportingPaths({
      body,
      absoluteBaseDir: missingDir,
    });
    expect(expanded.body).toContain('references/syntax.md (not in this skill; do not read)');
    expect(expanded.presentPaths).toEqual([]);
    expect(expanded.missingPaths).toEqual(['references/syntax.md']);
    expect(expanded.rootEntries).toEqual([]);
  });
});

describe('formatSkillToolBlock', () => {
  let skillDir: string;

  beforeEach(() => {
    skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-format-skill-'));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill\n');
    fs.mkdirSync(path.join(skillDir, 'references'));
    fs.writeFileSync(path.join(skillDir, 'references', 'syntax.md'), '# Syntax\n');
  });

  afterEach(() => {
    fs.rmSync(skillDir, { recursive: true, force: true });
  });

  it('lists the skill directory, expanded files, and missing references', () => {
    const location = path.join(skillDir, 'SKILL.md');
    const syntaxPath = path.join(skillDir, 'references', 'syntax.md');
    const text = formatSkillToolBlock({
      name: 'obsidian-marp',
      location,
      body: 'Read `docs/marp-extended-syntax.md` then `references/syntax.md`.',
      absoluteBaseDir: skillDir,
    });

    expect(text).toContain(`<skill name="obsidian-marp" location="${location}">`);
    expect(text).toContain('Do not join relative names onto that directory');
    expect(text).toContain(`Skill directory: ${skillDir}`);
    expect(text).toContain(`${path.join(skillDir, 'SKILL.md')} (file)`);
    expect(text).toContain(`${path.join(skillDir, 'references')} (folder)`);
    expect(text).toContain('Present supporting files:');
    expect(text).toContain(`- ${syntaxPath}`);
    expect(text).toContain('Not present in this skill (do not read):');
    expect(text).toContain('- docs/marp-extended-syntax.md');
    expect(text).toContain(`\`${syntaxPath}\``);
    expect(text).toContain('docs/marp-extended-syntax.md (not in this skill; do not read)');
  });
});
