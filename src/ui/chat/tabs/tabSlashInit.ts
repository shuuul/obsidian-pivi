import type { SlashCommandDropdownConfig } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";
import { MarkdownView, Notice } from "obsidian";

import type PiviPlugin from "@/app/PiviPluginHost";
import { GENERATE_IMAGE_COMMAND_ID } from "@/app/workspace/PiSlashCommandCatalog";
import { SlashCommandDropdown } from "@/ui/shared/components/SlashCommandDropdown";

import type { TabData } from "./types";

export function initializeSlashCommands(
  tab: TabData,
  plugin: PiviPlugin,
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
        if (command.id === GENERATE_IMAGE_COMMAND_ID) {
          const prefix = `/${command.name} `;
          const text = dom.richInput.value;
          const prompt = text.startsWith(prefix) ? text.substring(prefix.length) : "";
          dom.richInput.value = `${command.content}${prompt}`;
          dom.richInput.selectionStart = dom.richInput.value.length;
          dom.richInput.focus();
          dom.richInput.el.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
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
                command.content.includes("{{selected_text}}")
              ) {
                new Notice("No text selected in the active editor.");
              }

              let fileContent = "";
              if (file) {
                fileContent = await plugin.app.vault.read(file);
              }

              const fileName = file?.basename ?? "";
              const dateStr = new Date().toLocaleDateString();

              const resolvedContent = command.content
                .replace(/{{selected_text}}/g, selectedText)
                .replace(/{{current_note}}/g, fileContent)
                .replace(/{{current_file}}/g, fileContent)
                .replace(/{{current_note_name}}/g, fileName)
                .replace(/{{current_file_name}}/g, fileName)
                .replace(/{{date}}/g, dateStr);

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
              dom.richInput.el.dispatchEvent(
                new Event("input", { bubbles: true }),
              );
            } catch (error) {
              console.error(
                "Pivi: Failed to resolve custom template command:",
                error,
              );
              new Notice("Failed to resolve template command variables.");
            }
          })();
        }
      },
      onHide: () => {},
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      catalogConfig: catalogInfo?.config,
      getCatalogEntries: catalogInfo?.getEntries,
      getMcpManager: () => plugin.getPiWorkspace()?.mcpServerManager ?? null,
      getMcpToolProvider: () => plugin.getPiWorkspace()?.mcpToolProvider ?? null,
      getSkills: () => plugin.getPiWorkspace()?.skillProvider.listSkills() ?? [],
    },
  );
}