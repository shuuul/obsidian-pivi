import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createListPathTool, createReadNoteTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

const NOTE_NOT_FOUND = 'Note not found. Provide file= (wikilink name) or path= (vault-relative).';
const VAULT_PATH_NOT_FOUND = 'Vault path not found: .pivi/skills';

describe('unmanaged vault path errors', () => {
  let vaultPath: string;
  let skillFile: string;
  let skillDir: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-unmanaged-vault-'));
    skillDir = path.join(vaultPath, '.pivi', 'skills');
    skillFile = path.join(skillDir, 'guide.md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, '# skill');
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  function readDeps(overrides: Partial<ObsidianToolDeps> = {}): ObsidianToolDeps {
    return {
      vault: {
        readNote: jest.fn().mockRejectedValue(new Error(NOTE_NOT_FOUND)),
      },
      settings: { defaultReadMaxChars: 100_000 },
      vaultPath,
      externalFiles: {
        isPathAllowed: () => false,
        readFile: jest.fn(),
        listPath: jest.fn(),
        stat: jest.fn(),
      },
      ...overrides,
    } as unknown as ObsidianToolDeps;
  }

  function listDeps(overrides: Partial<ObsidianToolDeps> = {}): ObsidianToolDeps {
    return {
      vault: {
        listPath: jest.fn().mockImplementation(() => {
          throw new Error(VAULT_PATH_NOT_FOUND);
        }),
      },
      settings: {},
      vaultPath,
      externalFiles: {
        isPathAllowed: () => false,
        readFile: jest.fn(),
        listPath: jest.fn(),
        stat: jest.fn(),
      },
      ...overrides,
    } as unknown as ObsidianToolDeps;
  }

  it('routes an on-disk unindexed file through ExternalFileApi instead of retrying a sibling tool', async () => {
    const readFile = jest.fn().mockResolvedValue({ path: skillFile, content: '# skill' });
    const tool = createReadNoteTool(readDeps({
      externalFiles: { isPathAllowed: () => true, readFile, listPath: jest.fn(), stat: jest.fn() },
    }));

    const result = await tool.execute('call', { path: '.pivi/skills/guide.md' }) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(readFile).toHaveBeenCalledWith(skillFile);
    expect(result.content[0]?.text).toContain('# skill');
  });

  it('keeps the original obsidian_read miss when the path is not on disk', async () => {
    const tool = createReadNoteTool(readDeps());

    await expect(tool.execute('call', { path: '.pivi/skills/missing.md' })).rejects.toThrow(NOTE_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/skills/missing.md' })).rejects.not.toThrow('obsidian_read_external');
  });

  it('keeps the original read miss when read itself is disabled from routing', async () => {
    const deps = readDeps();
    deps.settings.disabledTools = ['read'];
    const tool = createReadNoteTool(deps);

    await expect(tool.execute('call', { path: '.pivi/skills/guide.md' })).rejects.toThrow(NOTE_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/skills/guide.md' })).rejects.not.toThrow('obsidian_read_external');
  });

  it('routes an on-disk unindexed folder through ExternalFileApi instead of retrying a sibling tool', async () => {
    const listPath = jest.fn().mockResolvedValue([{ name: 'guide.md', kind: 'file' }]);
    const tool = createListPathTool(listDeps({
      externalFiles: { isPathAllowed: () => true, readFile: jest.fn(), listPath, stat: jest.fn() },
    }));

    const result = await tool.execute('call', { path: '.pivi/skills' }) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(listPath).toHaveBeenCalledWith(skillDir);
    expect(result.content[0]?.text).toContain('guide.md');
  });

  it('keeps the original obsidian_list miss when the folder is not on disk', async () => {
    const tool = createListPathTool(listDeps());

    await expect(tool.execute('call', { path: '.pivi/missing' })).rejects.toThrow(VAULT_PATH_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/missing' })).rejects.not.toThrow('obsidian_list_external');
  });
});
