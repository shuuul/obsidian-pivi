import { createInlineContextToken } from '@pivi/pivi-agent-core/context/inlineContext';
import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import {
  requiresSelectedText,
  resolveWorkspaceCommandPrompt,
} from '@pivi/pivi-agent-core/skills/commands/resolveWorkspaceCommandPrompt';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { type App, type Command,getIcon, MarkdownView, Notice } from 'obsidian';

import { t } from '@/app/i18n';
import { activatePiviView, ensurePiviViewOpen } from '@/app/piviViewActivation';
import { captureEditorSelectionInlineContext } from '@/ui/chat/ui/InlineContext';

const logger = new PluginLogger('WorkspaceCommandRegistry');

interface WorkspaceCommandRegistryHost {
  readonly app: App;
  readonly manifest: { readonly id: string };
  readonly settings: { readonly chatViewPlacement: 'right-sidebar' | 'left-sidebar' | 'main-tab' };
  addCommand(command: Command): Command;
  removeCommand(commandId: string): void;
}

interface NoteToolbarApiWindow extends Window {
  ntb?: { getSelection?: () => string };
}

function captureWorkspaceCommandSelection(markdownView: MarkdownView | null): {
  selectedText: string;
  selectedTextToken: string;
} {
  const ownerWindow = markdownView?.containerEl.ownerDocument
    .defaultView as NoteToolbarApiWindow | null;
  const isSourceMode = markdownView?.getMode() === 'source';
  const inlineContext = isSourceMode && markdownView
    ? captureEditorSelectionInlineContext(markdownView.editor, markdownView)
    : null;
  const selectedText = (isSourceMode ? markdownView.editor.getSelection() : '')
    || ownerWindow?.ntb?.getSelection?.()
    || ownerWindow?.getSelection()?.toString()
    || '';
  return {
    selectedText,
    selectedTextToken: inlineContext ? createInlineContextToken(inlineContext) : selectedText,
  };
}

export function getWorkspaceCommandLocalId(integrationKey: string): string {
  return `workspace-command-${integrationKey}`;
}

export function getWorkspaceCommandFullId(pluginId: string, integrationKey: string): string {
  return `${pluginId}:${getWorkspaceCommandLocalId(integrationKey)}`;
}

export class WorkspaceCommandRegistry {
  private readonly registered = new Set<string>();

  constructor(private readonly host: WorkspaceCommandRegistryHost) {}

  reconcile(entries: readonly SlashCatalogEntry[]): void {
    this.clear();
    for (const entry of entries) {
      if (!entry.integrationKey) continue;
      this.host.addCommand({
        id: getWorkspaceCommandLocalId(entry.integrationKey),
        name: t('commands.runWorkspaceCommand', { name: entry.name }),
        icon: entry.icon && getIcon(entry.icon) ? entry.icon : 'message-square',
        callback: () => {
          void this.execute(entry).catch((error: unknown) => {
            logger.error(`Failed to run workspace command /${entry.name}`, error);
            new Notice(t('commands.workspaceCommandUnavailable'));
          });
        },
      });
      this.registered.add(getWorkspaceCommandFullId(this.host.manifest.id, entry.integrationKey));
    }
  }

  clear(): void {
    for (const commandId of this.registered) {
      this.host.removeCommand(commandId);
    }
    this.registered.clear();
  }

  private async execute(entry: SlashCatalogEntry): Promise<void> {
    const markdownView = this.host.app.workspace.getActiveViewOfType(MarkdownView);
    const { selectedText, selectedTextToken } = captureWorkspaceCommandSelection(markdownView);

    if (requiresSelectedText(entry.content) && !selectedText.trim()) {
      new Notice(t('chat.errors.noTextSelected'));
      return;
    }

    const file = markdownView?.file ?? null;
    const currentNote = file ? await this.host.app.vault.read(file) : '';
    const content = resolveWorkspaceCommandPrompt(entry.content, {
      selectedText: selectedTextToken,
      currentNote,
      currentNoteName: file?.basename ?? '',
      date: new Date().toLocaleDateString(),
    }).trim();
    if (!content) {
      new Notice(t('commands.workspaceCommandEmpty'));
      return;
    }

    await activatePiviView(this.host.app, this.host.settings.chatViewPlacement);
    const view = await ensurePiviViewOpen(this.host.app, this.host.settings.chatViewPlacement);
    const sent = await view?.getChatHandle()?.commands
      .sendWorkspaceCommandInNewSession(content) ?? false;
    if (!sent) {
      new Notice(t('commands.workspaceCommandUnavailable'));
    }
  }
}
