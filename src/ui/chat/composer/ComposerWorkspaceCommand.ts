import {
  requiresSelectedText,
  resolveWorkspaceCommandPrompt,
  type WorkspaceCommandPromptContext,
} from '@pivi/pivi-agent-core/skills/commands/resolveWorkspaceCommandPrompt';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

export interface ResolvedComposerWorkspaceCommand {
  promptContent: string;
  missingSelectedText: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolve the first workspace command token while preserving the composer text for display. */
export async function resolveComposerWorkspaceCommand(
  content: string,
  entries: readonly SlashCatalogEntry[],
  getContext: () => Promise<WorkspaceCommandPromptContext>,
): Promise<ResolvedComposerWorkspaceCommand> {
  const workspaceCommands = entries.filter(
    (entry) => entry.kind === 'command' && entry.source === 'user',
  );
  if (workspaceCommands.length === 0) {
    return { promptContent: content, missingSelectedText: false };
  }

  const commandNames = workspaceCommands
    .map((entry) => entry.name)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const match = new RegExp(`(^|\\s)/(${commandNames})(?=\\s|$)`, 'i').exec(content);
  if (!match) {
    return { promptContent: content, missingSelectedText: false };
  }

  const commandName = match[2]?.toLowerCase();
  const command = workspaceCommands.find(
    (entry) => entry.name.toLowerCase() === commandName,
  );
  if (!command) {
    return { promptContent: content, missingSelectedText: false };
  }

  const context = await getContext();
  const commandStart = match.index + (match[1]?.length ?? 0);
  const commandEnd = commandStart + command.name.length + 1;
  return {
    promptContent:
      content.slice(0, commandStart)
      + resolveWorkspaceCommandPrompt(command.content, context)
      + content.slice(commandEnd),
    missingSelectedText: requiresSelectedText(command.content) && !context.selectedText.trim(),
  };
}
