import { createBashTool, createGenerateImageTool, createObsidianTools } from '@pivi/obsidian-tools';

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
    } as never).map((tool) => tool.name))
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
    } as never, {
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

  it('generates an image, saves it as an attachment, and appends the embed', async () => {
    const vault = makeVault();
    const tool = createGenerateImageTool({
      vault: vault as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: {} as never,
      vaultName: 'vault',
      processRunner: {} as never,
      imageGenerator: {
        generateImage: jest.fn(async () => ({
          data: 'aGk=',
          mimeType: 'image/png',
          outputFormat: 'png' as const,
          model: 'gpt-5.5',
          backendImageModel: 'gpt-image-2',
        })),
      },
    });

    const result = await tool.execute('call-1', {
      prompt: 'Generate a pixel icon',
      filename: 'icon.png',
      insertMode: 'append',
    }) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details: Record<string, unknown> };

    expect(vault.writeAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: 'icon.png', sourcePath: 'note.md' }));
    expect(vault.getAttachment('assets/icon.png')?.byteLength).toBe(2);
    expect(vault.getNote('note.md')).toBe('hello\n\n![[assets/icon.png]]\n');
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'image', data: 'aGk=', mimeType: 'image/png' }),
    ]));
    expect(result.details.markdown).toBe('![[assets/icon.png]]');
  });
});

describe('createBashTool', () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    process.env.SHELL = '/bin/zsh';
  });

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
  });

  it('registers Bash only when allowBash is enabled', () => {
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
      bashAllowlist: ['git'],
      allowEval: false,
      allowExternalRead: false,
      externalReadDirectories: [],
    };

    expect(createObsidianTools(app as never, baseSettings).map((tool) => tool.name))
      .not.toContain('obsidian_bash');
    expect(createObsidianTools(app as never, { ...baseSettings, allowBash: true }).map((tool) => tool.name))
      .toContain('obsidian_bash');
  });

  it('runs single-line commands that match the Bash allowlist', async () => {
    const processRunner = {
      run: jest.fn(async () => ({ exitCode: 0, stdout: 'ok\n', stderr: '' })),
    };
    const tool = createBashTool({
      vault: {} as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: {
        cliTimeoutMs: 12_000,
        bashAllowlist: ['git', 'npm run build'],
      } as never,
      vaultName: 'vault',
      processRunner,
    });

    await expect(tool.execute('call-1', { command: 'git status', cwd: '/tmp' }))
      .resolves.toEqual(expect.objectContaining({ content: [expect.objectContaining({ text: expect.stringContaining('ok') })] }));
    await expect(tool.execute('call-2', { command: 'npm run build:css' }))
      .resolves.toBeDefined();

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: '/bin/zsh',
      args: ['-lc', 'git status'],
      cwd: '/tmp',
      timeoutMs: 12_000,
    }));
  });

  it('allows basic lookup commands without user allowlist entries', async () => {
    const processRunner = {
      run: jest.fn(async () => ({ exitCode: 0, stdout: '/opt/homebrew/bin/ntn\n', stderr: '' })),
    };
    const tool = createBashTool({
      vault: {} as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: { cliTimeoutMs: 30_000, bashAllowlist: [] } as never,
      vaultName: 'vault',
      processRunner,
    });

    await expect(tool.execute('call-1', { command: 'type ntn' })).resolves.toBeDefined();

    expect(processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: '/bin/zsh',
      args: ['-lc', 'type ntn'],
    }));
  });

  it('rejects multi-line or non-allowlisted Bash commands', async () => {
    const processRunner = { run: jest.fn() };
    const tool = createBashTool({
      vault: {} as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: { cliTimeoutMs: 30_000, bashAllowlist: ['git'] } as never,
      vaultName: 'vault',
      processRunner,
    });

    await expect(tool.execute('call-1', { command: 'git status\npwd' })).rejects.toThrow('single line');
    await expect(tool.execute('call-2', { command: 'rm -rf tmp' })).rejects.toThrow('not in allowlist');
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('rejects shell control syntax before invoking the process runner', async () => {
    const processRunner = { run: jest.fn() };
    const tool = createBashTool({
      vault: {} as never,
      cli: {} as never,
      externalFiles: {} as never,
      settings: { cliTimeoutMs: 30_000, bashAllowlist: ['git', 'pwd'] } as never,
      vaultName: 'vault',
      processRunner,
    });

    await expect(tool.execute('call-1', { command: 'pwd ; ls' })).rejects.toThrow('shell control syntax');
    await expect(tool.execute('call-2', { command: 'git status && echo pwned' })).rejects.toThrow('shell control syntax');
    expect(processRunner.run).not.toHaveBeenCalled();
  });
});
