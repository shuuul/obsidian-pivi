import type { Skill } from '@pivi/skills/vault/loadVaultSkills';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vaultSkillLoader from '@pivi/skills/vault/loadVaultSkills';
import {
  normalizeSkillSlug,
  parseRemoteSkillsListOutput,
  syncCliSkillsIntoPivi,
  VaultSkillsService,
} from '@pivi/skills/vault/VaultSkillsService';

describe('normalizeSkillSlug', () => {
  it('accepts owner/repo', () => {
    expect(normalizeSkillSlug('vercel-labs/agent-skills')).toBe('vercel-labs/agent-skills');
  });

  it('parses GitHub URLs', () => {
    expect(normalizeSkillSlug('https://github.com/foo/bar.git')).toBe(
      'https://github.com/foo/bar.git',
    );
  });

  it('accepts git URLs and direct repo paths supported by npx skills', () => {
    expect(normalizeSkillSlug('git@github.com:heptameta/heptabase-cli-skills.git')).toBe(
      'git@github.com:heptameta/heptabase-cli-skills.git',
    );
    expect(
      normalizeSkillSlug('https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design'),
    ).toBe('https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design');
  });

  it('parses skills.sh URLs', () => {
    expect(normalizeSkillSlug('https://skills.sh/vercel-labs/agent-skills')).toBe(
      'vercel-labs/agent-skills',
    );
  });

  it('rejects empty sources', () => {
    expect(() => normalizeSkillSlug('   ')).toThrow(/skills source/);
  });
});

describe('parseRemoteSkillsListOutput', () => {
  it('extracts skill names and descriptions from npx skills --list output', () => {
    const output = `
◇  Available Skills
│
│    frontend-design
│
│      Review UI code for design compliance.
│
│    skill-creator
│
│      Create or improve agent skills.
│
└  Use --skill <name> to install specific skills
`;

    expect(parseRemoteSkillsListOutput(output)).toEqual([
      { name: 'frontend-design', description: 'Review UI code for design compliance.' },
      { name: 'skill-creator', description: 'Create or improve agent skills.' },
    ]);
  });

  it('handles decorated skills CLI output with cursor-control ANSI sequences', () => {
    const output = `
\x1B[38;5;250m███████╗\x1B[0m
┌   skills
\x1B[?25l│
◇  Source: https://github.com/makenotion/skills.git
\x1B[?25h\x1B[?25l│
◒  Cloning repository\x1B[999D\x1B[J◇  Repository cloned
\x1B[?25h\x1B[?25l│
\x1B[999D\x1B[J◇  Found 1 skill
\x1B[?25h
│
◇  Available Skills
│
│    notion-cli
│
│      Use the Notion CLI (\`ntn\`) to interact with the Notion API, manage workers, and upload files.

│
└  Use --skill <name> to install specific skills
`;

    expect(parseRemoteSkillsListOutput(output)).toEqual([
      {
        name: 'notion-cli',
        description:
          'Use the Notion CLI (`ntn`) to interact with the Notion API, manage workers, and upload files.',
      },
    ]);
  });
});

describe('VaultSkillsService sync', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skills-'));
    fs.mkdirSync(path.join(vaultPath, '.pivi', 'skills'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('lists skills from loadVaultSkills', () => {
    const skillMd = path.join(vaultPath, '.pivi', 'skills', 'demo-skill', 'SKILL.md');
    const mockSkill = {
      name: 'demo',
      description: 'Demo skill',
      filePath: skillMd,
      baseDir: path.dirname(skillMd),
      sourceInfo: {
        source: 'pivi-vault',
        path: skillMd,
        scope: 'project',
        origin: 'package',
      },
      disableModelInvocation: false,
    } as Skill;

    jest.spyOn(vaultSkillLoader, 'loadVaultSkills').mockReturnValue({
      skills: [mockSkill],
      skillsXml: '<skills/>',
    });

    const service = new VaultSkillsService(vaultPath);
    const listed = service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('demo');
    expect(listed[0]?.folderName).toBe('demo-skill');
  });

  it('removes a skill folder', () => {
    const skillDir = path.join(vaultPath, '.pivi', 'skills', 'to-remove');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\ndescription: y\n---\n', 'utf-8');

    const service = new VaultSkillsService(vaultPath);
    service.remove('to-remove');
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('migrates root skills CLI metadata into .pivi work dir', () => {
    const rootLock = path.join(vaultPath, 'skills-lock.json');
    fs.writeFileSync(rootLock, '{"version":1}', 'utf-8');

    new VaultSkillsService(vaultPath);

    expect(fs.existsSync(rootLock)).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills-lock.json'))).toBe(true);
  });

  it('removes duplicate root skills CLI metadata when .pivi copy already exists', () => {
    const rootLock = path.join(vaultPath, 'skills-lock.json');
    const piviLock = path.join(vaultPath, '.pivi', 'skills-lock.json');
    fs.writeFileSync(rootLock, '{"version":1}', 'utf-8');
    fs.writeFileSync(piviLock, '{"version":1}', 'utf-8');

    new VaultSkillsService(vaultPath);

    expect(fs.existsSync(rootLock)).toBe(false);
    expect(fs.readFileSync(piviLock, 'utf-8')).toBe('{"version":1}');
  });

  it('syncs flat skills from .agents/skills into .pivi/skills', () => {
    const flatDir = path.join(vaultPath, '.agents', 'skills', 'flat-skill');
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(
      path.join(flatDir, 'SKILL.md'),
      '---\nname: flat\ndescription: flat skill\n---\n',
      'utf-8',
    );

    const synced = syncCliSkillsIntoPivi(vaultPath, new Set());
    expect(synced).toEqual(['flat-skill']);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'flat-skill', 'SKILL.md'))).toBe(
      true,
    );
  });

  it('syncs skills written under .pivi by npx skills working directory', () => {
    const flatDir = path.join(vaultPath, '.pivi', '.agents', 'skills', 'flat-skill');
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(
      path.join(flatDir, 'SKILL.md'),
      '---\nname: flat\ndescription: flat skill\n---\n',
      'utf-8',
    );

    const synced = syncCliSkillsIntoPivi(vaultPath, new Set());
    expect(synced).toEqual(['flat-skill']);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'flat-skill', 'SKILL.md'))).toBe(
      true,
    );
  });

  it('treats skills already written to .pivi/skills as synced', () => {
    const flatDir = path.join(vaultPath, '.pivi', 'skills', 'direct-skill');
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(
      path.join(flatDir, 'SKILL.md'),
      '---\nname: direct\ndescription: direct skill\n---\n',
      'utf-8',
    );

    const synced = syncCliSkillsIntoPivi(vaultPath, new Set(), {
      overwriteFolders: new Set(['direct-skill']),
    });
    expect(synced).toEqual(['direct-skill']);
    expect(fs.existsSync(path.join(flatDir, 'SKILL.md'))).toBe(true);
  });

  it('syncs nested monorepo skills from .agents/skills/<repo>/skills/', () => {
    const nestedSkill = path.join(
      vaultPath,
      '.agents',
      'skills',
      'obsidian-skills',
      'skills',
      'nested-skill',
    );
    fs.mkdirSync(nestedSkill, { recursive: true });
    fs.writeFileSync(
      path.join(nestedSkill, 'SKILL.md'),
      '---\nname: nested\ndescription: nested skill\n---\n',
      'utf-8',
    );

    const synced = syncCliSkillsIntoPivi(vaultPath, new Set());
    expect(synced).toEqual(['nested-skill']);
    expect(
      fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'nested-skill', 'SKILL.md')),
    ).toBe(true);
  });

  it('overwrites existing folders when overwriteFolders is set', () => {
    const existing = path.join(vaultPath, '.pivi', 'skills', 'flat-skill');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: old\ndescription: old\n---\n',
      'utf-8',
    );

    const flatDir = path.join(vaultPath, '.agents', 'skills', 'flat-skill');
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(
      path.join(flatDir, 'SKILL.md'),
      '---\nname: new\ndescription: new\n---\n',
      'utf-8',
    );

    syncCliSkillsIntoPivi(vaultPath, new Set(['flat-skill']), {
      overwriteFolders: new Set(['flat-skill']),
    });
    const content = fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: new');
  });

  it('skips skill folders that already exist in .pivi/skills', () => {
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: e\ndescription: e\n---\n', 'utf-8');

    const flatDir = path.join(vaultPath, '.agents', 'skills', 'existing');
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(path.join(flatDir, 'SKILL.md'), '---\nname: e2\ndescription: e2\n---\n', 'utf-8');

    const synced = syncCliSkillsIntoPivi(vaultPath, new Set(['existing']));
    expect(synced).toEqual([]);
  });
});
