import {
  DEFAULT_WORKSPACE_COMMANDS,
  ensureDefaultWorkspaceCommands,
  seedDefaultWorkspaceCommands,
} from '@pivi/pivi-agent-core/skills/commands/defaultWorkspaceCommands';
import type { FileStore } from '@pivi/pivi-agent-core/ports';

describe('default workspace commands', () => {
  function createAdapter(existing: readonly string[] = []) {
    const files = new Set(existing);
    const adapter = {
      ensureFolder: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn(async (path: string) => files.has(path)),
      write: jest.fn(async (path: string) => { files.add(path); }),
    } as unknown as jest.Mocked<FileStore>;
    return { adapter, files };
  }

  it('seeds editable summarize and polish command files', async () => {
    const { adapter } = createAdapter();

    await seedDefaultWorkspaceCommands(adapter);

    expect(DEFAULT_WORKSPACE_COMMANDS.map(command => command.id)).toEqual([
      'summarize',
      'polish',
    ]);
    expect(adapter.write).toHaveBeenCalledWith(
      '.pivi/commands/summarize.md',
      expect.stringMatching(/icon: list-collapse[\s\S]*integration-key: default-summarize[\s\S]*\{\{selected_text\}\}/),
    );
    expect(adapter.write).toHaveBeenCalledWith(
      '.pivi/commands/polish.md',
      expect.stringMatching(/icon: sparkles[\s\S]*integration-key: default-polish[\s\S]*\{\{selected_text\}\}/),
    );
  });

  it('does not overwrite an existing command with the same name', async () => {
    const { adapter } = createAdapter(['.pivi/commands/summarize.md']);

    await seedDefaultWorkspaceCommands(adapter);

    expect(adapter.write).not.toHaveBeenCalledWith(
      '.pivi/commands/summarize.md',
      expect.any(String),
    );
    expect(adapter.write).toHaveBeenCalledWith(
      '.pivi/commands/polish.md',
      expect.any(String),
    );
  });

  it('marks seeding only after both command files and settings are saved', async () => {
    const { adapter } = createAdapter();
    const settings: { defaultWorkspaceCommandsSeeded?: boolean } = {};
    const saveSettings = jest.fn(async () => undefined);

    await expect(ensureDefaultWorkspaceCommands(adapter, settings, saveSettings))
      .resolves.toBe(true);
    expect(settings.defaultWorkspaceCommandsSeeded).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);

    await expect(ensureDefaultWorkspaceCommands(adapter, settings, saveSettings))
      .resolves.toBe(false);
    expect(adapter.write).toHaveBeenCalledTimes(2);
  });

  it('does not mark a partial seed as complete', async () => {
    const { adapter } = createAdapter();
    adapter.write.mockRejectedValueOnce(new Error('disk full'));
    const settings: { defaultWorkspaceCommandsSeeded?: boolean } = {};

    await expect(ensureDefaultWorkspaceCommands(adapter, settings, async () => undefined))
      .rejects.toThrow('disk full');
    expect(settings.defaultWorkspaceCommandsSeeded).toBeUndefined();
  });
});
