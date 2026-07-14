import type { SlashCommand } from '../../foundation/settings';
import type { FileStore } from '../../ports';
import { serializeSlashCommandMarkdown } from '../slashCommand';

export const WORKSPACE_COMMANDS_DIR = '.pivi/commands';

export const DEFAULT_WORKSPACE_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'summarize',
    name: 'summarize',
    description: 'Summarize the selected text',
    argumentHint: 'summarize',
    icon: 'list-collapse',
    integrationKey: 'default-summarize',
    content: 'Summarize the following text clearly and concisely:\n\n{{selected_text}}',
    source: 'user',
    kind: 'command',
  },
  {
    id: 'polish',
    name: 'polish',
    description: 'Polish the selected text',
    argumentHint: 'polish',
    icon: 'sparkles',
    integrationKey: 'default-polish',
    content: 'Polish the following text for clarity, fluency, and style while preserving its meaning:\n\n{{selected_text}}',
    source: 'user',
    kind: 'command',
  },
];

export async function seedDefaultWorkspaceCommands(
  adapter: FileStore,
): Promise<void> {
  await adapter.ensureFolder(WORKSPACE_COMMANDS_DIR);
  for (const command of DEFAULT_WORKSPACE_COMMANDS) {
    const path = `${WORKSPACE_COMMANDS_DIR}/${command.id}.md`;
    if (await adapter.exists(path)) continue;
    await adapter.write(path, serializeSlashCommandMarkdown(command, command.content));
  }
}

export async function ensureDefaultWorkspaceCommands(
  adapter: FileStore,
  settings: { defaultWorkspaceCommandsSeeded?: boolean },
  saveSettings: () => Promise<void>,
): Promise<boolean> {
  if (settings.defaultWorkspaceCommandsSeeded === true) return false;
  await seedDefaultWorkspaceCommands(adapter);
  settings.defaultWorkspaceCommandsSeeded = true;
  try {
    await saveSettings();
  } catch (error) {
    delete settings.defaultWorkspaceCommandsSeeded;
    throw error;
  }
  return true;
}
