import type { App } from 'obsidian';

export interface ObsidianCommandListEntry {
  readonly id: string;
  readonly name: string;
  readonly iconId?: string;
}

interface ObsidianCommandsRegistry {
  listCommands(): Array<{ id: string; name: string; icon?: string }>;
}

type AppWithCommands = App & {
  commands?: ObsidianCommandsRegistry;
};

/** Lists registered Obsidian command-palette commands via the semi-private commands API. */
export function listObsidianCommands(app: App): readonly ObsidianCommandListEntry[] {
  const commands = (app as AppWithCommands).commands;
  if (!commands || typeof commands.listCommands !== 'function') {
    return [];
  }

  return commands.listCommands()
    .filter((command): command is { id: string; name: string; icon?: string } => (
      typeof command.id === 'string'
      && command.id.trim().length > 0
      && typeof command.name === 'string'
      && command.name.trim().length > 0
    ))
    .map((command) => ({
      id: command.id.trim(),
      name: command.name.trim(),
      ...(typeof command.icon === 'string' && command.icon.trim()
        ? { iconId: command.icon.trim() }
        : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
