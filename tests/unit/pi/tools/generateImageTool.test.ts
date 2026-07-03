import { createGenerateImageTool, createObsidianTools } from '@pivi/obsidian-tools';

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

    expect(createObsidianTools(app as never, {} as never, null).map((tool) => tool.name))
      .not.toContain('obsidian_generate_image');
    expect(createObsidianTools(app as never, {} as never, null, {
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
      allowEval: false,
    }, null, {
      imageGenerator: {
        generateImage: jest.fn(),
      },
    }).map((tool) => tool.name);

    expect(tools).not.toContain('obsidian_read');
    expect(tools).not.toContain('obsidian_generate_image');
    expect(tools).toContain('obsidian_edit');
  });

  it('generates an image, saves it as an attachment, and appends the embed', async () => {
    const vault = makeVault();
    const approve = jest.fn(async () => 'allow' as const);
    const tool = createGenerateImageTool({
      vault: vault as never,
      cli: {} as never,
      settings: {} as never,
      vaultName: 'vault',
      approve,
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

    expect(approve).toHaveBeenCalledWith('obsidian_generate_image', expect.any(Object), expect.stringContaining('Obsidian generate image'));
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
