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
      ...overrides,
    } as unknown as ObsidianToolDeps;
  }

  it('tells obsidian_read to retry with obsidian_read_external for an on-disk unindexed file', async () => {
    const tool = createReadNoteTool(readDeps());

    await expect(tool.execute('call', { path: '.pivi/skills/guide.md' })).rejects.toThrow(
      `${NOTE_NOT_FOUND} This file exists on disk but is not an Obsidian-indexed vault file. Retry with \`obsidian_read_external\` using the absolute path \`${skillFile}\`.`,
    );
  });

  it('keeps the original obsidian_read miss when the path is not on disk', async () => {
    const tool = createReadNoteTool(readDeps());

    await expect(tool.execute('call', { path: '.pivi/skills/missing.md' })).rejects.toThrow(NOTE_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/skills/missing.md' })).rejects.not.toThrow('obsidian_read_external');
  });

  it('does not mention obsidian_read_external when that tool is disabled', async () => {
    const deps = readDeps();
    deps.settings.disabledTools = ['obsidian_read_external'];
    const tool = createReadNoteTool(deps);

    await expect(tool.execute('call', { path: '.pivi/skills/guide.md' })).rejects.toThrow(NOTE_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/skills/guide.md' })).rejects.not.toThrow('obsidian_read_external');
  });

  it('tells obsidian_list to retry with obsidian_list_external for an on-disk unindexed folder', async () => {
    const tool = createListPathTool(listDeps());

    await expect(tool.execute('call', { path: '.pivi/skills' })).rejects.toThrow(
      `${VAULT_PATH_NOT_FOUND} This folder exists on disk but is not an Obsidian-indexed vault folder. Retry with \`obsidian_list_external\` using the absolute path \`${skillDir}\`.`,
    );
  });

  it('keeps the original obsidian_list miss when the folder is not on disk', async () => {
    const tool = createListPathTool(listDeps());

    await expect(tool.execute('call', { path: '.pivi/missing' })).rejects.toThrow(VAULT_PATH_NOT_FOUND);
    await expect(tool.execute('call', { path: '.pivi/missing' })).rejects.not.toThrow('obsidian_list_external');
  });
});
