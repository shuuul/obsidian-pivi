import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import {
  requiresSelectedText,
  resolveWorkspaceCommandPrompt,
} from "@pivi/pivi-agent-core/skills/commands/resolveWorkspaceCommandPrompt";
import type { SlashCommandDropdownConfig } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";
import { MarkdownView, Notice } from "obsidian";

import type { PiviChatHost } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { SlashCommandDropdown } from "@/ui/shared/components/SlashCommandDropdown";
import { getActiveWindow } from "@/ui/shared/dom";

import {
  createDropdownMcpServerProvider,
  createDropdownMcpToolProvider,
} from "./tabCatalogAdapters";
import type { TabData } from "./types";

export function initializeSlashCommands(
  tab: TabData,
  plugin: PiviChatHost,
  ports: ChatPorts,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: {
    config: SlashCommandDropdownConfig;
    getEntries: () => Promise<SlashCatalogEntry[]>;
  } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.richInput,
    {
      onSelect: (command) => {
        if (command.source === "user") {
          void (async () => {
            try {
              const activeView =
                plugin.app.workspace.getActiveViewOfType(MarkdownView);
              const editor = activeView?.editor;
              const file = activeView?.file;

              const selectedText = editor?.getSelection() ?? "";
              if (
                !selectedText &&
                requiresSelectedText(command.content)
              ) {
                new Notice(t("chat.errors.noTextSelected"));
              }

              let fileContent = "";
              if (file) {
                fileContent = await plugin.app.vault.read(file);
              }

              const fileName = file?.basename ?? "";
              const dateStr = new Date().toLocaleDateString();

              const resolvedContent = resolveWorkspaceCommandPrompt(command.content, {
                selectedText,
                currentNote: fileContent,
                currentNoteName: fileName,
                date: dateStr,
              });

              const text = dom.richInput.value;
              const prefix = `/${command.name} `;
              if (text.startsWith(prefix)) {
                dom.richInput.value =
                  resolvedContent + text.substring(prefix.length);
                dom.richInput.selectionStart = resolvedContent.length;
              } else {
                const index = text.indexOf(prefix);
                if (index !== -1) {
                  dom.richInput.value =
                    text.substring(0, index) +
                    resolvedContent +
                    text.substring(index + prefix.length);
                  dom.richInput.selectionStart = index + resolvedContent.length;
                } else {
                  dom.richInput.value = resolvedContent;
                  dom.richInput.selectionStart = resolvedContent.length;
                }
              }

              dom.richInput.focus();
              const EventConstructor = (getActiveWindow(dom.richInput.el) as unknown as {
                Event: typeof Event;
              }).Event;
              dom.richInput.el.dispatchEvent(
                new EventConstructor("input", { bubbles: true }),
              );
            } catch (error) {
              console.error(
                "Pivi: Failed to resolve custom template command:",
                error,
              );
              new Notice(t("chat.errors.templateVarsFailed"));
            }
          })();
        }
      },
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      catalogConfig: catalogInfo?.config,
      getCatalogEntries: catalogInfo?.getEntries,
      getMcpManager: () => createDropdownMcpServerProvider(ports.catalog),
      getMcpToolProvider: () => createDropdownMcpToolProvider(ports.catalog),
      getSkills: () => ports.catalog.listSkills(),
    },
  );
}
