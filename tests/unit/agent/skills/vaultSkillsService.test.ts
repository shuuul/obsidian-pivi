import type { Skill } from '@pivi/agent/skills/vault/loadVaultSkills';
import type { ProcessRunner, ProcessRunRequest } from '@pivi/agent/ports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vaultSkillLoader from '@pivi/agent/skills/vault/loadVaultSkills';
import {
  normalizeSkillSlug,
  parseRemoteSkillsListOutput,
  VaultSkillsService,
} from '@pivi/agent/skills/vault/vaultSkillsService';

describe('normalizeSkillSlug', () => {
  it('accepts owner/repo', () => {
    expect(normalizeSkillSlug('vercel-labs/agent-skills')).toBe('vercel-labs/agent-skills');
  });

  it('parses GitHub URLs', () => {
    expect(normalizeSkillSlug('https://github.com/foo/bar.git')).toBe(
      'https://github.com/foo/bar.git',
    );
  });

  it('accepts git URLs and direct repo paths supported by the skills CLI', () => {
    expect(normalizeSkillSlug('git@github.com:heptameta/heptabase-cli-skills.git')).toBe(
      'git@github.com:heptameta/heptabase-cli-skills.git',
    );
    expect(
      normalizeSkillSlug(
        'https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design',
      ),
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
  it('extracts skill names and descriptions from skills --list output', () => {
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

  function writeCliSkill(folderName: string, skillName = folderName, cwd = vaultPath): void {
    const skillDir = path.join(cwd, '.agents', 'skills', folderName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n`,
      'utf-8',
    );
  }

  function pinnedSkillsOptions(): {
    skillsCliPackageRoot: string;
    processEnv: NodeJS.ProcessEnv;
  } {
    return {
      skillsCliPackageRoot: path.join(process.cwd(), 'node_modules', 'skills'),
      processEnv: {
        HOME: vaultPath,
        PATH: '/usr/bin',
      },
    };
  }

  function expectPinnedSkillsInvocation(
    request: ProcessRunRequest | undefined,
    cliArgs: string[],
  ): void {
    expect(request?.executable.toLowerCase()).toContain('node');
    expect(request?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expect(request?.args?.slice(1)).toEqual(cliArgs);
    expect(request?.shell).toEqual({ mode: 'forbidden' });
  }

  function snapshotManagedSkillsArtifacts(): Map<string, Buffer> {
    const snapshot = new Map<string, Buffer>();
    const visit = (absolutePath: string, relativePath: string): void => {
      if (!fs.existsSync(absolutePath)) return;
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(absolutePath).sort()) {
          visit(path.join(absolutePath, entry), path.join(relativePath, entry));
        }
      } else {
        snapshot.set(relativePath, fs.readFileSync(absolutePath));
      }
    };
    visit(path.join(vaultPath, '.pivi', 'skills'), 'skills');
    visit(path.join(vaultPath, '.pivi', 'skills-lock.json'), 'skills-lock.json');
    visit(path.join(vaultPath, '.pivi', '.skills.json'), '.skills.json');
    return snapshot;
  }

  async function expectRenameFailureRollback(
    failurePhase: 'backup' | 'publication',
  ): Promise<void> {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), Buffer.from([0, 1, 2, 255]));
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'skills-lock.json'), '{"old":true}\n');
    fs.writeFileSync(path.join(vaultPath, '.pivi', '.skills.json'), '{"old":"metadata"}\n');
    const before = snapshotManagedSkillsArtifacts();
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('existing', 'new', request.cwd);
        fs.writeFileSync(path.join(request.cwd!, 'skills-lock.json'), '{"new":true}\n');
        fs.writeFileSync(path.join(request.cwd!, '.skills.json'), '{"new":"metadata"}\n');
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    let injected = false;
    const publicationRenameSync: typeof fs.renameSync = (oldPath, newPath) => {
      const oldName = oldPath.toString();
      const newName = newPath.toString();
      const shouldFail =
        failurePhase === 'backup'
          ? newName.includes(`${path.sep}previous${path.sep}skills-lock.json`)
          : oldName.includes(`${path.sep}next${path.sep}skills-lock.json`);
      if (shouldFail && !injected) {
        injected = true;
        throw new Error(`injected ${failurePhase} rename failure`);
      }
      fs.renameSync(oldPath, newPath);
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
      publicationRenameSync,
    });
    await expect(service.updateAll()).rejects.toThrow(/injected .* rename failure/);
    expect(snapshotManagedSkillsArtifacts()).toEqual(before);
    expect(
      fs
        .readdirSync(path.join(vaultPath, '.pivi'))
        .some((name) => name.startsWith('.skills-transaction-')),
    ).toBe(false);
  }

  it('preserves every managed artifact when a backup rename fails', async () => {
    expect.assertions(3);
    await expectRenameFailureRollback('backup');
  });

  it('preserves every managed artifact when a publication rename fails', async () => {
    expect.assertions(3);
    await expectRenameFailureRollback('publication');
  });

  it('rejects symlinks copied from pre-existing skills before publication', async () => {
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: existing\n---\n', 'utf8');
    const symlinkTarget = path.join(vaultPath, 'outside-root');
    fs.mkdirSync(symlinkTarget);
    fs.symlinkSync(
      symlinkTarget,
      path.join(existing, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('new-skill', 'new', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });

    await expect(service.updateAll()).rejects.toThrow(
      /Symlinks are forbidden|escapes staging root/,
    );
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'existing', 'linked'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'new-skill'))).toBe(false);
  });

  it('serializes publications across service instances for one vault', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('first', 'first', request.cwd);
        firstStarted();
        await firstGate;
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    const secondRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('second', 'second', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    for (const folderName of ['first', 'second']) {
      const skillDir = path.join(vaultPath, '.pivi', 'skills', folderName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: old\ndescription: old\n---\n',
        'utf-8',
      );
    }
    const first = new VaultSkillsService(vaultPath, {
      processRunner: firstRunner,
      processEnv,
      skillsCliPackageRoot,
    }).updateAll();
    await firstReady;
    const second = new VaultSkillsService(vaultPath, {
      processRunner: secondRunner,
      processEnv,
      skillsCliPackageRoot,
    }).updateAll();
    await Promise.resolve();
    expect(secondRunner.run).not.toHaveBeenCalled();
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([['first'], ['second']]);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'first'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'second'))).toBe(true);
  });

  it('blocks publication when another service cannot recover pending metadata', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-pending-metadata');
    const previousSkills = path.join(transaction, 'previous', 'skills');
    const liveSkills = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(previousSkills, { recursive: true });
    fs.writeFileSync(path.join(previousSkills, 'SKILL.md'), 'previous');
    fs.writeFileSync(path.join(liveSkills, 'SKILL.md'), 'published');
    fs.writeFileSync(
      path.join(transaction, 'transaction.json'),
      JSON.stringify({
        phase: 'published',
        originalArtifacts: ['skills'],
        backedUpArtifacts: ['skills'],
        publishedArtifacts: ['skills'],
        metadata: { mutation: { action: 'install', source: 'owner/repo' } },
        metadataCommitted: false,
      }),
    );
    const processRunner: ProcessRunner = { run: jest.fn() };
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });

    await expect(service.updateAll()).rejects.toThrow('requires metadata recovery');

    expect(processRunner.run).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(liveSkills, 'SKILL.md'), 'utf8')).toBe('published');
    expect(fs.readFileSync(path.join(previousSkills, 'SKILL.md'), 'utf8')).toBe('previous');
    expect(fs.existsSync(transaction)).toBe(true);
  });

  it('discovers a backup created before manifest progress was recorded', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-crash');
    const previous = path.join(transaction, 'previous');
    const liveSkills = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(path.join(previous, 'skills'), { recursive: true });
    fs.mkdirSync(liveSkills, { recursive: true });
    fs.writeFileSync(path.join(previous, 'skills', 'SKILL.md'), 'old');
    fs.writeFileSync(path.join(liveSkills, 'SKILL.md'), 'new');
    fs.writeFileSync(
      path.join(transaction, 'transaction.json'),
      JSON.stringify({
        phase: 'mutating',
        originalArtifacts: ['skills'],
        backedUpArtifacts: [],
        publishedArtifacts: [],
      }),
    );

    await new VaultSkillsService(vaultPath).prepareWorkspace();

    expect(fs.readFileSync(path.join(liveSkills, 'SKILL.md'), 'utf8')).toBe('old');
    expect(fs.existsSync(transaction)).toBe(false);
  });

  it('does not delete an artifact restored before a later rollback failure', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-retry');
    const previous = path.join(transaction, 'previous');
    const liveSkills = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(previous, { recursive: true });
    fs.mkdirSync(liveSkills, { recursive: true });
    fs.writeFileSync(path.join(liveSkills, 'SKILL.md'), 'already restored');
    fs.writeFileSync(path.join(previous, 'skills-lock.json'), 'old lock');
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'skills-lock.json'), 'new lock');
    fs.writeFileSync(
      path.join(transaction, 'transaction.json'),
      JSON.stringify({
        phase: 'restore-incomplete',
        originalArtifacts: ['skills', 'skills-lock.json'],
        backedUpArtifacts: ['skills-lock.json'],
        publishedArtifacts: ['skills', 'skills-lock.json'],
      }),
    );

    await new VaultSkillsService(vaultPath).prepareWorkspace();

    expect(fs.readFileSync(path.join(liveSkills, 'SKILL.md'), 'utf8')).toBe('already restored');
    expect(fs.readFileSync(path.join(vaultPath, '.pivi', 'skills-lock.json'), 'utf8')).toBe(
      'old lock',
    );
    expect(fs.existsSync(transaction)).toBe(false);
  });

  it('lists skills from loadVaultSkills', () => {
    const skillMd = path.join(vaultPath, '.pivi', 'skills', 'demo-skill', 'SKILL.md');
    const mockSkill = {
      name: 'demo',
      description: 'Demo skill',
      filePath: skillMd,
      baseDir: path.dirname(skillMd),
      absoluteFilePath: skillMd,
      absoluteBaseDir: path.dirname(skillMd),
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
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: toggle\ndescription: y\n---\n',
      'utf-8',
    );

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
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: x\ndescription: y\n---\n',
      'utf-8',
    );

    const service = new VaultSkillsService(vaultPath);
    service.remove('to-remove');
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('restores a removed skill when durable metadata publication fails', async () => {
    const skillDir = path.join(vaultPath, '.pivi', 'skills', 'to-remove');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: x\ndescription: y\n---\n',
      'utf-8',
    );
    const service = new VaultSkillsService(vaultPath);

    await expect(
      service.removeTransactional('to-remove', {
        afterPublish: () => {
          throw new Error('metadata failed');
        },
      }),
    ).rejects.toThrow('metadata failed');

    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('name: x');
    expect(
      fs
        .readdirSync(path.join(vaultPath, '.pivi'))
        .some((name) => name.startsWith('.skills-transaction-')),
    ).toBe(false);
  });

  it('runs skills list through the injected process runner', async () => {
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdout: '◇  Available Skills\n│\n│    demo\n│\n│      Demo skill.\n',
          stderr: '',
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      skillsCliPackageRoot: path.join(process.cwd(), 'node_modules', 'skills'),
    });
    await expect(service.listRemoteSkills('owner/repo')).resolves.toEqual([
      { name: 'demo', description: 'Demo skill.' },
    ]);

    expectPinnedSkillsInvocation(calls[0], ['add', 'owner/repo', '--list']);
    expect(calls[0]?.cwd).toContain(path.join(os.tmpdir(), 'pivi-skills-list-'));
    expect(calls[0]?.cwdPolicy).toEqual({ mode: 'approved-root', root: calls[0]?.cwd });
    expect(calls[0]?.timeoutMs).toBe(120_000);
  });

  it('runs skills commands with injected process environment lookup', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    processEnv.CUSTOM_SKILLS_ENV = 'injected';
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdout: '◇  Available Skills\n│\n│    demo\n│\n│      Demo skill.\n',
          stderr: '',
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });

    await service.listRemoteSkills('owner/repo');

    expect(calls[0]?.executable.toLowerCase()).toContain('node');
    expect(calls[0]?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expect(calls[0]?.env?.CUSTOM_SKILLS_ENV).toBe('injected');
    // PATH still enhanced for node resolution
  });

  it('keeps shell forbidden on Windows for the pinned skills CLI', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdoutTruncated: false,
          stderrTruncated: false,
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
      processEnv,
      processRunner,
      skillsCliPackageRoot,
    });

    await service.listRemoteSkills('owner/repo');
    expectPinnedSkillsInvocation(calls[0], ['add', 'owner/repo', '--list']);
    expect(calls[0]?.shell).toEqual({ mode: 'forbidden' });
  });

  it('installs selected remote skills through the process runner', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('selected-skill', 'selected', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(
      service.installFromSource('owner/repo', { skillNames: ['selected'] }),
    ).resolves.toEqual(['selected-skill']);

    expectPinnedSkillsInvocation(calls[0], [
      'add',
      'owner/repo',
      '--copy',
      '-y',
      '--skill',
      'selected',
    ]);
    expect(calls[0]?.cwd).toContain(path.join(vaultPath, '.pivi', 'skills-install-'));
  });

  it('installs a normalized slug without selected skill flags', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('all-skills', 'all', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.installFromSlug('https://github.com/owner/repo.git')).resolves.toEqual([
      'all-skills',
    ]);

    expectPinnedSkillsInvocation(calls[0], [
      'add',
      'https://github.com/owner/repo.git',
      '--copy',
      '-y',
    ]);
  });

  it('updates all existing skills through the process runner', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: old\ndescription: old\n---\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          old: {
            skillPath: 'SKILL.md',
            source: 'repo',
            ref: 'main',
            computedHash: 'old',
          },
        },
      }),
      'utf-8',
    );
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('renamed', 'new', request.cwd);
        fs.writeFileSync(
          path.join(request.cwd!, 'skills-lock.json'),
          JSON.stringify({
            version: 1,
            skills: {
              new: {
                skillPath: 'SKILL.md',
                source: 'repo',
                ref: 'main',
                computedHash: 'new',
              },
            },
          }),
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['existing']);

    expect(calls[0]?.executable.toLowerCase()).toContain('node');
    expect(calls[0]?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expectPinnedSkillsInvocation(calls[0], ['update', '-p', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: new');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'renamed'))).toBe(false);
    const publishedLock = JSON.parse(
      fs.readFileSync(path.join(vaultPath, '.pivi', 'skills-lock.json'), 'utf-8'),
    ) as { skills: Record<string, unknown> };
    expect(Object.keys(publishedLock.skills)).toEqual(['new']);

    fs.appendFileSync(path.join(existing, 'SKILL.md'), 'local edit\n', 'utf-8');
    const secondRunner: ProcessRunner = {
      run: jest.fn(async () => {
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    const secondService = new VaultSkillsService(vaultPath, {
      processRunner: secondRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(secondService.updateAll()).resolves.toEqual([]);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('local edit');

    const thirdRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('new', 'new', request.cwd);
        fs.writeFileSync(
          path.join(request.cwd!, 'skills-lock.json'),
          JSON.stringify({
            version: 1,
            skills: {
              new: {
                skillPath: 'SKILL.md',
                source: 'repo',
                ref: 'main',
                computedHash: 'newer',
              },
            },
          }),
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };
    const thirdService = new VaultSkillsService(vaultPath, {
      processRunner: thirdRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(thirdService.updateAll()).resolves.toEqual(['existing']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: new');
  });

  it('keeps local edits and nested skills when the CLI reports no changes', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    const nested = path.join(existing, 'skills', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: existing\ndescription: existing\n---\nlocal edit\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(nested, 'SKILL.md'), '---\nname: nested\n---\n', 'utf-8');
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        expect(
          fs.readFileSync(
            path.join(request.cwd!, '.agents', 'skills', 'existing', 'SKILL.md'),
            'utf-8',
          ),
        ).toContain('local edit');
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(processRunner.run).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('local edit');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'nested'))).toBe(false);
  });

  it('imports only folders written by the CLI and not nested skills of unchanged parents', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const parent = path.join(vaultPath, '.pivi', 'skills', 'parent');
    const nested = path.join(parent, 'skills', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'SKILL.md'),
      '---\nname: parent\ndescription: parent\n---\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(nested, 'SKILL.md'), '---\nname: nested\n---\n', 'utf-8');
    fs.mkdirSync(path.join(vaultPath, '.pivi', 'skills', 'target'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills', 'target', 'SKILL.md'),
      '---\nname: target\ndescription: target\n---\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        expect(
          fs.readFileSync(
            path.join(request.cwd!, '.agents', 'skills', 'parent', 'SKILL.md'),
            'utf-8',
          ),
        ).toContain('name: parent');
        writeCliSkill('target', 'target', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['target']);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'nested'))).toBe(false);
    expect(fs.existsSync(path.join(nested, 'SKILL.md'))).toBe(true);
  });

  it('does not recreate a removed skill when the CLI re-emits its lock entry', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('removed', 'removed', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'removed'))).toBe(false);
  });

  it('does not import nested skills when an existing parent updates', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    const nested = path.join(existing, 'skills', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: existing\ndescription: existing\n---\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(nested, 'SKILL.md'), '---\nname: nested\n---\n', 'utf-8');
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('existing', 'updated', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['existing']);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'nested'))).toBe(false);
    expect(fs.existsSync(path.join(nested, 'SKILL.md'))).toBe(true);
  });

  it('does not import nested skills under a disabled parent when that parent updates', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    const nested = path.join(existing, 'skills', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: existing\ndescription: existing\n---\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(existing, '.disabled'), 'disabled\n', 'utf-8');
    fs.writeFileSync(path.join(nested, 'SKILL.md'), '---\nname: nested\n---\n', 'utf-8');
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('existing', 'updated', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['existing']);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'nested'))).toBe(false);
    expect(fs.existsSync(path.join(existing, '.disabled'))).toBe(true);
  });

  it('does not refresh nested skills under a renamed disabled parent', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const parent = path.join(vaultPath, '.pivi', 'skills', 'my-disabled');
    const nested = path.join(parent, 'skills', 'child');
    const installedChild = path.join(vaultPath, '.pivi', 'skills', 'child');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(installedChild, { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'SKILL.md'),
      '---\nname: parent\ndescription: parent\n---\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(parent, '.disabled'), 'disabled\n', 'utf-8');
    fs.writeFileSync(
      path.join(nested, 'SKILL.md'),
      '---\nname: child\ndescription: child\n---\nold\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedChild, 'SKILL.md'),
      '---\nname: child\ndescription: child\n---\nold\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('parent', 'parent', request.cwd);
        const cliChild = path.join(request.cwd!, '.agents', 'skills', 'parent', 'skills', 'child');
        fs.mkdirSync(cliChild, { recursive: true });
        fs.writeFileSync(
          path.join(cliChild, 'SKILL.md'),
          '---\nname: child\ndescription: child\n---\nnew\n',
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['my-disabled']);

    expect(fs.readFileSync(path.join(installedChild, 'SKILL.md'), 'utf-8')).toContain('old');
  });

  it('keeps a skill whose local edit removed its description', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: existing\n---\nlocal edit\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        expect(fs.existsSync(path.join(request.cwd!, '.agents', 'skills', 'existing'))).toBe(false);
        writeCliSkill('existing', 'existing', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('local edit');
  });

  it('does not overwrite a live skill whose name was edited locally', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: local-name\ndescription: local\n---\nlocal edit\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({ version: 1, skills: { 'upstream-name': {} } }),
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('existing', 'upstream-name', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('local edit');
  });

  it('does not match a removed skill to an installed skill from another source', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const installed = path.join(vaultPath, '.pivi', 'skills', 'installed');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(
      path.join(installed, 'SKILL.md'),
      '---\nname: installed\ndescription: installed\n---\noriginal\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          installed: {
            skillPath: 'SKILL.md',
            source: 'repo-a',
            ref: 'main',
            computedHash: 'installed',
          },
          removed: {
            skillPath: 'SKILL.md',
            source: 'repo-b',
            ref: 'main',
            computedHash: 'removed',
          },
        },
      }),
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('removed', 'removed', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf-8')).toContain('original');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'removed'))).toBe(false);
  });

  it('keeps an updated skill when a removed sibling is renamed', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const installed = path.join(vaultPath, '.pivi', 'skills', 'installed');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(
      path.join(installed, 'SKILL.md'),
      '---\nname: installed\ndescription: installed\n---\nold\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          installed: {
            skillPath: 'SKILL.md',
            source: 'repo-a',
            ref: 'main',
            computedHash: 'old',
          },
          removed: {
            skillPath: 'removed/SKILL.md',
            source: 'repo-a',
            ref: 'main',
            computedHash: 'removed',
          },
        },
      }),
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('installed', 'installed', request.cwd);
        writeCliSkill('removed-renamed', 'removed-renamed', request.cwd);
        fs.writeFileSync(
          path.join(request.cwd!, 'skills-lock.json'),
          JSON.stringify({
            version: 1,
            skills: {
              installed: {
                skillPath: 'SKILL.md',
                source: 'repo-a',
                ref: 'main',
                computedHash: 'new',
              },
              removed: {
                skillPath: 'removed/SKILL.md',
                source: 'repo-a',
                ref: 'main',
                computedHash: 'renamed',
              },
            },
          }),
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['installed']);

    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf-8')).toContain('name: installed');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'removed-renamed'))).toBe(false);
  });

  it('reserves a genuine update before assigning a removed rename', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const live = path.join(vaultPath, '.pivi', 'skills', 'my-alpha');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(
      path.join(live, 'SKILL.md'),
      '---\nname: alpha\ndescription: alpha\n---\nold\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          alpha: {
            skillPath: 'SKILL.md',
            source: 'repo-a',
            ref: 'main',
            computedHash: 'old',
          },
          removed: {
            skillPath: 'removed/SKILL.md',
            source: 'repo-a',
            ref: 'main',
            computedHash: 'removed',
          },
        },
      }),
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('alpha', 'alpha', request.cwd);
        writeCliSkill('aardvark', 'aardvark', request.cwd);
        fs.writeFileSync(
          path.join(request.cwd!, 'skills-lock.json'),
          JSON.stringify({
            version: 1,
            skills: {
              alpha: {
                skillPath: 'SKILL.md',
                source: 'repo-a',
                ref: 'main',
                computedHash: 'new',
              },
              removed: {
                skillPath: 'removed/SKILL.md',
                source: 'repo-a',
                ref: 'main',
                computedHash: 'renamed',
              },
            },
          }),
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['my-alpha']);

    expect(fs.readFileSync(path.join(live, 'SKILL.md'), 'utf-8')).toContain('name: alpha\n');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'aardvark'))).toBe(false);
  });

  it('does not reassign a removed lock entry to a manual skill', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const manual = path.join(vaultPath, '.pivi', 'skills', 'manual');
    fs.mkdirSync(manual, { recursive: true });
    fs.writeFileSync(
      path.join(manual, 'SKILL.md'),
      '---\nname: manual\ndescription: manual\n---\noriginal\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, '.pivi', 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          removed: {
            skillPath: 'SKILL.md',
            source: 'repo',
            ref: 'main',
            computedHash: 'old',
          },
        },
      }),
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('removed', 'removed', request.cwd);
        fs.writeFileSync(
          path.join(request.cwd!, 'skills-lock.json'),
          JSON.stringify({
            version: 1,
            skills: {
              removed: {
                skillPath: 'SKILL.md',
                source: 'repo',
                ref: 'main',
                computedHash: 'new',
              },
            },
          }),
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.readFileSync(path.join(manual, 'SKILL.md'), 'utf-8')).toContain('original');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'removed'))).toBe(false);
  });

  it('ignores alternate CLI output roots during updates', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        const alternate = path.join(request.cwd!, 'skills', 'removed');
        fs.mkdirSync(alternate, { recursive: true });
        fs.writeFileSync(
          path.join(alternate, 'SKILL.md'),
          '---\nname: removed\ndescription: removed\n---\n',
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual([]);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'removed'))).toBe(false);
  });

  it('updates a renamed folder through its skill identity', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'my-demo');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: demo\ndescription: demo\n---\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('demo', 'demo', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['my-demo']);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'demo'))).toBe(false);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: demo');
  });

  it('refreshes an already installed nested skill when its parent updates', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const parent = path.join(vaultPath, '.pivi', 'skills', 'parent');
    const nested = path.join(parent, 'skills', 'child');
    const installedChild = path.join(vaultPath, '.pivi', 'skills', 'child');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(installedChild, { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'SKILL.md'),
      '---\nname: parent\ndescription: parent\n---\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(nested, 'SKILL.md'),
      '---\nname: child\ndescription: child\n---\nold\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedChild, 'SKILL.md'),
      '---\nname: child\ndescription: child\n---\nold\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('parent', 'parent', request.cwd);
        const cliChild = path.join(request.cwd!, '.agents', 'skills', 'parent', 'skills', 'child');
        fs.mkdirSync(cliChild, { recursive: true });
        fs.writeFileSync(
          path.join(cliChild, 'SKILL.md'),
          '---\nname: child\ndescription: child\n---\nnew\n',
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['parent', 'child']);

    expect(fs.readFileSync(path.join(installedChild, 'SKILL.md'), 'utf-8')).toContain('new');
  });

  it('does not replace an unrelated live folder with a nested refresh', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const parent = path.join(vaultPath, '.pivi', 'skills', 'parent');
    const nested = path.join(parent, 'skills', 'child');
    const installedChild = path.join(vaultPath, '.pivi', 'skills', 'child');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(installedChild, { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'SKILL.md'),
      '---\nname: parent\ndescription: parent\n---\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(nested, 'SKILL.md'),
      '---\nname: child\ndescription: child\n---\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedChild, 'SKILL.md'),
      '---\nname: unrelated\ndescription: unrelated\n---\noriginal\n',
      'utf-8',
    );
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('parent', 'parent', request.cwd);
        const cliChild = path.join(request.cwd!, '.agents', 'skills', 'parent', 'skills', 'child');
        fs.mkdirSync(cliChild, { recursive: true });
        fs.writeFileSync(
          path.join(cliChild, 'SKILL.md'),
          '---\nname: child\ndescription: child\n---\n',
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['parent']);

    expect(fs.readFileSync(path.join(installedChild, 'SKILL.md'), 'utf-8')).toContain('original');
  });

  it('does not install nested skills through an alternate root for a disabled parent', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const disabledParent = path.join(vaultPath, '.pivi', 'skills', 'parent');
    fs.mkdirSync(disabledParent, { recursive: true });
    fs.writeFileSync(path.join(disabledParent, 'SKILL.md'), '---\nname: parent\n---\n', 'utf-8');
    fs.writeFileSync(path.join(disabledParent, '.disabled'), 'disabled\n', 'utf-8');
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        writeCliSkill('new-skill', 'new', request.cwd);
        const alternateParent = path.join(request.cwd!, 'skills', 'parent');
        const alternateChild = path.join(alternateParent, 'skills', 'child');
        fs.mkdirSync(alternateChild, { recursive: true });
        fs.writeFileSync(
          path.join(alternateParent, 'SKILL.md'),
          '---\nname: parent\ndescription: parent\n---\n',
          'utf-8',
        );
        fs.writeFileSync(
          path.join(alternateChild, 'SKILL.md'),
          '---\nname: child\ndescription: child\n---\n',
          'utf-8',
        );
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.installFromSlug('owner/repo')).resolves.toEqual(['new-skill']);

    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'child'))).toBe(false);
    expect(fs.existsSync(path.join(disabledParent, '.disabled'))).toBe(true);
  });

  it('updates one skill through the process runner', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'target-folder');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: old\ndescription: old\n---\n',
      'utf-8',
    );
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('target-folder', 'target', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateSkill('target', 'target-folder')).resolves.toEqual([
      'target-folder',
    ]);

    expect(calls[0]?.executable.toLowerCase()).toContain('node');
    expect(calls[0]?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expectPinnedSkillsInvocation(calls[0], ['update', 'target', '-p', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: target');
  });

  it('upgrades default bundle folders through the process runner', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'obsidian-markdown');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: old\ndescription: old\n---\n',
      'utf-8',
    );
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('obsidian-markdown', 'markdown', request.cwd);
        writeCliSkill('json-canvas', 'canvas', request.cwd);
        writeCliSkill('obsidian-cli', 'cli', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.upgradeDefaultBundle(new Set(['obsidian-cli']))).resolves.toEqual([
      'json-canvas',
      'obsidian-markdown',
    ]);

    expect(calls[0]?.executable.toLowerCase()).toContain('node');
    expect(calls[0]?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expectPinnedSkillsInvocation(calls[0], ['add', 'kepano/obsidian-skills', '--copy', '-y']);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: markdown');
    expect(fs.existsSync(path.join(vaultPath, '.pivi', 'skills', 'obsidian-cli'))).toBe(false);
  });

  it('reports skills CLI failures from the injected process runner', async () => {
    const processRunner: ProcessRunner = {
      run: jest.fn(async () => ({
        termination: 'exit' as const,
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'network failed',
        stdoutTruncated: false,
        stderrTruncated: false,
      })),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      skillsCliPackageRoot: path.join(process.cwd(), 'node_modules', 'skills'),
    });
    await expect(service.listRemoteSkills('owner/repo')).rejects.toThrow(
      'skills list failed: network failed',
    );
  });

  it('preserves the disabled marker when updating an existing skill', async () => {
    const { processEnv, skillsCliPackageRoot } = pinnedSkillsOptions();
    const existing = path.join(vaultPath, '.pivi', 'skills', 'existing');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(
      path.join(existing, 'SKILL.md'),
      '---\nname: old\ndescription: old\n---\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(existing, '.disabled'), 'disabled\n', 'utf-8');
    const calls: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: jest.fn(async (request) => {
        calls.push(request);
        writeCliSkill('existing', 'new', request.cwd);
        return {
          termination: 'exit' as const,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
    };

    const service = new VaultSkillsService(vaultPath, {
      processRunner,
      processEnv,
      skillsCliPackageRoot,
    });
    await expect(service.updateAll()).resolves.toEqual(['existing']);

    expect(calls[0]?.executable.toLowerCase()).toContain('node');
    expect(calls[0]?.args?.[0]).toMatch(/[/\\]bin[/\\]cli\.mjs$/);
    expectPinnedSkillsInvocation(calls[0], ['update', '-p', '-y']);
    expect(fs.existsSync(path.join(existing, '.disabled'))).toBe(true);
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf-8')).toContain('name: new');
    expect(service.list()[0]?.disabled).toBe(true);
  });

  it('rejects path-escaping folder names when toggling disabled state', () => {
    const skillDir = path.join(vaultPath, '.pivi', 'skills', 'safe-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: safe\ndescription: y\n---\n',
      'utf-8',
    );

    const service = new VaultSkillsService(vaultPath);
    expect(() => service.setSkillDisabled('../x', true)).toThrow(/Invalid skill folder name/);
    expect(() => service.setSkillDisabled('foo/bar', false)).toThrow(/Invalid skill folder name/);
    expect(fs.existsSync(path.join(skillDir, '.disabled'))).toBe(false);
  });
});
