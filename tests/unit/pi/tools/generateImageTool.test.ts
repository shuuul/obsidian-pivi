import { createBashTool, createGenerateImageTool, createObsidianTools } from '@pivi/obsidian-tools';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function makeVault() {
  const notes = new Map<string, string>([['note.md', 'hello']]);
  const attachments = new Map<string, ArrayBuffer>();
  return {
    getActiveFilePath: () => 'note.md',
    writeAttachment: jest.fn(async ({ filename, data }: { filename: string; data: ArrayBuffer }) => {
      const path = `assets/${filename}`;
      attachments.set(path, data);
      return {
        path,
        markdown: `![[${path}]]`,
        resourcePath: `app://resource/${path}`,
        size: data.byteLength,
        extension: filename.split('.').pop() ?? '',
      };
    }),
    writeNote: jest.fn(async ({ path, content }: { path: string; content: string }) => {
      notes.set(path, `${notes.get(path) ?? ''}${content}`);
      return { path };
    }),
    editNote: jest.fn(),
    getNote: (path: string) => notes.get(path),
    getAttachment: (path: string) => attachments.get(path),
  };
}

describe('createGenerateImageTool', () => {
  it('is registered only when an image generator is provided', () => {
    const app = {
      vault: { getName: () => 'vault' },
      workspace: { getActiveFile: () => null },
    };

    expect(createObsidianTools(app as never, {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: [],
      allowCommand: false,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: [],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    }).map((tool) => tool.name))
      .not.toContain('obsidian_generate_image');
    expect(createObsidianTools(app as never, {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: [],
      allowCommand: false,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: [],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    }, {
      imageGenerator: {
        generateImage: jest.fn(),
      },
    }).map((tool) => tool.name)).toContain('obsidian_generate_image');
  });

  it('omits disabled tools from the registered tool specs', () => {
    const app = {
      vault: { getName: () => 'vault' },
      workspace: { getActiveFile: () => null },
    };

    const tools = createObsidianTools(app as never, {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: ['obsidian_read', 'obsidian_generate_image'],
      allowCommand: false,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: [],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    }, {
      imageGenerator: {
        generateImage: jest.fn(),
      },
    }).map((tool) => tool.name);

    expect(tools).not.toContain('obsidian_read');
    expect(tools).not.toContain('obsidian_generate_image');
    expect(tools).toContain('obsidian_edit');
  });

  it('registers external read tools only when allowExternalRead is enabled and directories are configured', () => {
    const app = {
      vault: { getName: () => 'vault' },
      workspace: { getActiveFile: () => null },
    };
    const baseSettings = {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: [],
      allowCommand: false,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: [],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    };

    expect(createObsidianTools(app as never, baseSettings).map((tool) => tool.name))
      .not.toContain('obsidian_read_external');
    expect(createObsidianTools(app as never, {
      ...baseSettings,
      allowExternalRead: true,
      externalReadDirectories: [],
    }).map((tool) => tool.name)).not.toContain('obsidian_read_external');
    expect(createObsidianTools(app as never, {
      ...baseSettings,
      allowExternalRead: true,
      externalReadDirectories: ['/tmp'],
    }).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'obsidian_read_external',
      'obsidian_list_external',
    ]));
    expect(createObsidianTools(app as never, {
      ...baseSettings,
      allowExternalRead: false,
      externalReadDirectories: ['/tmp'],
    }).map((tool) => tool.name)).not.toContain('obsidian_read_external');
    expect(createObsidianTools(app as never, {
      ...baseSettings,
      allowExternalRead: true,
      externalReadDirectories: ['/tmp'],
      disabledTools: ['obsidian_read_external'],
    }).map((tool) => tool.name)).not.toContain('obsidian_read_external');
  });

  it('registers CLI-backed tools and optional CLI tools only when Obsidian CLI is available', () => {
    const app = {
      vault: { getName: () => 'vault' },
      workspace: { getActiveFile: () => null },
    };
    const baseSettings = {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: [],
      allowCommand: true,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: [],
      allowEval: true,
      allowExternalRead: false,
      externalReadDirectories: [],
    };

    expect(createObsidianTools(app as never, baseSettings, { obsidianCliAvailable: false }).map((tool) => tool.name))
      .toEqual(expect.not.arrayContaining([
        'obsidian_history',
        'obsidian_tasks',
        'obsidian_daily',
        'obsidian_command',
        'obsidian_eval',
      ]));

    expect(createObsidianTools(app as never, baseSettings, { obsidianCliAvailable: true }).map((tool) => tool.name))
      .toEqual(expect.arrayContaining([
        'obsidian_history',
        'obsidian_tasks',
        'obsidian_daily',
        'obsidian_command',
        'obsidian_eval',
      ]));
  });

  it('generates an image, saves it as an attachment, and appends the embed', async () => {
    const vault = makeVault();
    const tool = createGenerateImageTool({
      app: { vault: { adapter: { basePath: '/vault' } } } as never,
      vault: vault as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: {} as never,
      vaultName: 'vault',
      vaultPath: '/vault',
      processRunner: {} as never,
      imageGenerator: {
        generateImage: jest.fn(async () => ({
          data: 'aGk=',
          mimeType: 'image/png',
          outputFormat: 'png' as const,
          model: 'gpt-5.6-sol',
          backendImageModel: 'gpt-image-2',
        })),
      },
    });

    const result = await tool.execute('call-1', {
      prompt: 'Generate a pixel icon',
      filename: 'icon draft (1).png',
      insertMode: 'append',
    }) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details: Record<string, unknown> };

    expect(vault.writeAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: 'icon draft (1).png', sourcePath: 'note.md' }));
    expect(vault.getAttachment('assets/icon draft (1).png')?.byteLength).toBe(2);
    expect(vault.getNote('note.md')).toBe('hello\n\n![](assets/icon%20draft%20%281%29.png)\n');
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'image', data: 'aGk=', mimeType: 'image/png' }),
    ]));
    expect(result.details.markdown).toBe('![](assets/icon%20draft%20%281%29.png)');
  });
});

describe('createBashTool', () => {
  let binDir: string;
  let vaultDir: string;
  let originalPath: string | undefined;

  function makeApp() {
    return {
      vault: {
        getName: () => 'vault',
        adapter: { basePath: vaultDir },
      },
      workspace: { getActiveFile: () => null },
    };
  }

  function makeDeps(processRunner: { run: jest.Mock }, bashAllowlist: string[] = ['git', 'npm run build']) {
    return {
      app: makeApp() as never,
      vault: {} as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: {
        cliTimeoutMs: 12_000,
        bashAllowlist,
      } as never,
      vaultName: 'vault',
      vaultPath: vaultDir,
      processRunner,
    };
  }

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-bash-test-bin-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-bash-test-vault-'));
    for (const name of ['git', 'npm', 'type', 'pwd', 'which']) {
      const file = path.join(binDir, name);
      fs.writeFileSync(file, '#!/bin/sh\n');
      fs.chmodSync(file, 0o755);
    }
    originalPath = process.env.PATH;
    process.env.PATH = binDir;
  });

  afterEach(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it('registers Bash only when allowBash is enabled', () => {
    const baseSettings = {
      cliEnabled: true,
      cliPath: null,
      cliTimeoutMs: 30_000,
      disabledTools: [],
      allowCommand: false,
      commandAllowlist: [],
      allowBash: false,
      bashAllowlist: ['git'],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    };

    expect(createObsidianTools(makeApp() as never, baseSettings).map((tool) => tool.name))
      .not.toContain('obsidian_bash');
    expect(createObsidianTools(makeApp() as never, { ...baseSettings, allowBash: true }).map((tool) => tool.name))
      .toContain('obsidian_bash');
  });

  it('runs allowlisted executables without a login shell', async () => {
    const processRunner = {
      run: jest.fn(async () => ({
        termination: 'exit',
        exitCode: 0,
        signal: null,
        stdout: 'ok\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      })),
    };
    const tool = createBashTool(makeDeps(processRunner));

    expect(tool.description).toContain('Never use Bash to read, search, list, or modify vault files');
    expect(tool.description).toContain('without a login shell');
    await expect(tool.execute('call-1', { command: 'git status' }))
      .resolves.toEqual(expect.objectContaining({ content: [expect.objectContaining({ text: expect.stringContaining('ok') })] }));
    await expect(tool.execute('call-2', { command: 'npm run build' }))
      .resolves.toBeDefined();
    await expect(tool.execute('call-3', { command: 'npm run build:css' }))
      .rejects.toThrow('not in allowlist');

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: expect.stringContaining(`${binDir}${path.sep}git`),
      args: ['status'],
      cwdPolicy: { mode: 'vault', vaultRoot: vaultDir },
      timeoutMs: 12_000,
      shell: { mode: 'forbidden' },
    }));
  });

  it('rejects cwd outside the vault', async () => {
    const processRunner = {
      run: jest.fn(async () => ({
        termination: 'exit',
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      })),
    };
    const tool = createBashTool(makeDeps(processRunner));
    await expect(tool.execute('call-1', { command: 'git status', cwd: '/tmp' })).resolves.toBeDefined();
    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp',
      cwdPolicy: { mode: 'vault', vaultRoot: vaultDir },
    }));
  });

  it('allows basic lookup commands without user allowlist entries', async () => {
    const processRunner = {
      run: jest.fn(async () => ({
        termination: 'exit',
        exitCode: 0,
        signal: null,
        stdout: '/opt/homebrew/bin/ntn\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      })),
    };
    const tool = createBashTool(makeDeps(processRunner, []));

    await expect(tool.execute('call-1', { command: 'type ntn' })).resolves.toBeDefined();

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: expect.stringContaining(`${binDir}${path.sep}type`),
      args: ['ntn'],
      shell: { mode: 'forbidden' },
    }));
  });

  it('does not allow raw obsidian CLI access unless the user explicitly allowlists it', async () => {
    const processRunner = { run: jest.fn() };
    const tool = createBashTool(makeDeps(processRunner, []));

    await expect(tool.execute('call-1', { command: 'obsidian version' })).rejects.toThrow('not in allowlist');
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('rejects multi-line or non-allowlisted Bash commands', async () => {
    const processRunner = { run: jest.fn() };
    const tool = createBashTool(makeDeps(processRunner, ['git']));

    await expect(tool.execute('call-1', { command: 'git status\npwd' })).rejects.toThrow('single line');
    await expect(tool.execute('call-2', { command: 'rm -rf tmp' })).rejects.toThrow('not in allowlist');
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('rejects shell control syntax before invoking the process runner', async () => {
    const processRunner = { run: jest.fn() };
    const tool = createBashTool(makeDeps(processRunner, ['git', 'pwd']));

    await expect(tool.execute('call-1', { command: 'pwd ; ls' })).rejects.toThrow('shell control syntax');
    await expect(tool.execute('call-2', { command: 'git status && echo pwned' })).rejects.toThrow('shell control syntax');
    expect(processRunner.run).not.toHaveBeenCalled();
  });
});
