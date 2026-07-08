import type { Skill } from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import type { ProcessRunner, ProcessRunRequest } from '@pivi/pivi-agent-core/ports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vaultSkillLoader from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import { formatNpxNotFoundError } from '@pivi/pivi-agent-core/skills/vault/env';
import {
  normalizeSkillSlug,
  parseRemoteSkillsListOutput,
  syncCliSkillsIntoPivi,
  VaultSkillsService,
} from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';

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
    jest.restoreAllMocks();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeCliSkill(folderName: string, skillName = folderName): void {
    const skillDir = path.join(vaultPath, '.agents', 'skills', folderName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n`,
      'utf-8',
    );
  }

  function createNpxProcessEnv(): { processEnv: NodeJS.ProcessEnv; npxPath: string } {
    const binDir = path.join(vaultPath, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    const npxPath = path.join(binDir, 'npx');
    fs.writeFileSync(npxPath, '');
    return {
      npxPath,
      processEnv: {
        HOME: vaultPath,
        PATH: binDir,
      },
    };
  }

  it('lists skills from loadVaultSkills', () => {
    const skillMd = path.join(vaultPath, '.pivi', 'skills', 'demo-skill', 'SKILL.md');
    const mockSkill = {
      name: 'demo',
      description: 'Demo skill',
      filePath: skillMd,
      baseDir: path.dirname(skillMd),
      content: '# Demo skill',
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
    expect(listed[0]?.disabled).toBe(false);
  });

  it('toggles a skill disabled marker without removing the skill folder', () => {
    const skillDir = path.join(vaultPath, '.pivi', 'skills', 'toggle-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: toggle\ndescription: y\n---\n', 'utf-8');

    const service = new VaultSkillsService(vaultPath);
    service.setSkillDisabled('toggle-skill', true);
    expect(fs.existsSync(path.join(skillDir, '.disabled'))).toBe(true);
    expect(service.list()[0]?.disabled).toBe(true);

    service.setSkillDisabled('toggle-skill', false);
    expect(fs.existsSync(path.join(skillDir, '.disabled'))).toBe(false);
    expect(service.list()[0]?.disabled).toBe(false);
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

  it('runs skills list through the injected process runner', async () => {
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          exitCode: 0,
          stdout: '◇  Available Skills\n│\n│    demo\n│\n│      Demo skill.\n',
          stderr: '',
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner });
    await expect(service.listRemoteSkills('owner/repo')).resolves.toEqual([
      { name: 'demo', description: 'Demo skill.' },
    ]);

    expect(calls[0]?.args).toEqual(['skills', 'add', 'owner/repo', '--list']);
    expect(calls[0]?.cwd).toBe(path.join(vaultPath, '.pivi'));
    expect(calls[0]?.timeoutMs).toBe(120_000);
  });

  it('runs skills commands with injected process environment lookup', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    processEnv.CUSTOM_SKILLS_ENV = 'injected';
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          exitCode: 0,
          stdout: '◇  Available Skills\n│\n│    demo\n│\n│      Demo skill.\n',
          stderr: '',
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
    });

    await service.listRemoteSkills('owner/repo');

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.env?.CUSTOM_SKILLS_ENV).toBe('injected');
    expect(calls[0]?.env?.PATH?.split(':')).toContain(path.dirname(npxPath));
  });

  it('uses injected platform context for process runner shell mode', async () => {
    const binDir = path.join(vaultPath, 'win-bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node.exe'), '');
    const npxPath = path.join(binDir, 'npx.cmd');
    fs.writeFileSync(npxPath, '');
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          exitCode: 0,
          stdout: '◇  Available Skills\n│\n│    demo\n│\n│      Demo skill.\n',
          stderr: '',
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      environment: {
        execPath: path.join(vaultPath, 'Obsidian.exe'),
        homeDir: vaultPath,
        platform: 'win32',
      },
      processEnv: {
        HOME: vaultPath,
        PATH: binDir,
      },
      processRunner,
    });

    await service.listRemoteSkills('owner/repo');

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.shell).toBe(true);
  });

  it('installs selected remote skills through the process runner', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('selected-skill', 'selected');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner, processEnv });
    await expect(service.installFromSource('owner/repo', { skillNames: ['selected'] })).resolves.toEqual([
      'selected-skill',
    ]);

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.args).toEqual([
      'skills',
      'add',
      'owner/repo',
      '--copy',
      '-y',
      '--skill',
      'selected',
    ]);
    expect(calls[0]?.cwd).toBe(path.join(vaultPath, '.pivi'));
  });

  it('installs a normalized slug without selected skill flags', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('all-skills', 'all');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner, processEnv });
    await expect(service.installFromSlug('https://github.com/owner/repo.git')).resolves.toEqual([
      'all-skills',
    ]);

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.args).toEqual([
      'skills',
      'add',
      'https://github.com/owner/repo.git',
      '--copy',
      '-y',
    ]);
  });

  it('updates all existing skills through the process runner', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: old\ndescription: old\n---\n', 'utf-8');
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('existing', 'new');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner, processEnv });
    await expect(service.updateAll()).resolves.toEqual(['existing']);

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.args).toEqual(['skills', 'update', '-p', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: new');
  });

  it('updates one skill through the process runner', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'target-folder');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: old\ndescription: old\n---\n', 'utf-8');
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('target-folder', 'target');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner, processEnv });
    await expect(service.updateSkill('target', 'target-folder')).resolves.toEqual(['target-folder']);

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.args).toEqual(['skills', 'update', 'target', '-p', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: target');
  });

  it('upgrades default bundle folders through the process runner', async () => {
    const { processEnv, npxPath } = createNpxProcessEnv();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'obsidian-markdown');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: old\ndescription: old\n---\n', 'utf-8');
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('obsidian-markdown', 'markdown');
        writeCliSkill('json-canvas', 'canvas');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner, processEnv });
    await expect(service.upgradeDefaultBundle(new Set(['obsidian-cli']))).resolves.toEqual([
      'obsidian-markdown',
      'json-canvas',
    ]);

    expect(calls[0]?.command).toBe(npxPath);
    expect(calls[0]?.args).toEqual(['skills', 'add', 'kepano/obsidian-skills', '--copy', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: markdown');
  });

  it('reports injected node directory when formatting missing-npx errors', () => {
    const binDir = path.join(vaultPath, 'node-only-bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');

    expect(formatNpxNotFoundError({ HOME: vaultPath, PATH: binDir })).toContain(
      `Found node in ${binDir} but not npx alongside it.`,
    );
  });

  it('reports npx skills failures from the injected process runner', async () => {
    const processRunner: ProcessRunner = {
      run: jest.fn(async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'network failed',
      })),
    };

    const service = new VaultSkillsService(vaultPath, { processRunner });
    await expect(service.listRemoteSkills('owner/repo')).rejects.toThrow(
      'npx skills list failed: network failed',
    );
  });
});
