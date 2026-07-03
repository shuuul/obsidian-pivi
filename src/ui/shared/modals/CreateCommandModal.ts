import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { type App, Modal, Notice, Setting } from 'obsidian';

export interface CreateCommandModalOptions {
  initialEntry?: SlashCatalogEntry;
  getExistingCommandIds?: (currentEntry?: SlashCatalogEntry) => Promise<Set<string>> | Set<string>;
  onSave: (entry: SlashCatalogEntry, previousEntry?: SlashCatalogEntry) => Promise<void> | void;
}

function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
}

export class CreateCommandModal extends Modal {
  private commandName = '';
  private description = '';
  private argumentHint = 'text';
  private templateContent = 'Please analyze the following:\n{{selected_text}}';
  private isSaving = false;

  constructor(app: App, private readonly options: CreateCommandModalOptions) {
    super(app);
    if (options.initialEntry) {
      this.commandName = options.initialEntry.name;
      this.description = options.initialEntry.description ?? '';
      this.argumentHint = options.initialEntry.argumentHint ?? 'text';
      this.templateContent = options.initialEntry.content;
    }
  }

  onOpen() {
    this.setTitle(this.options.initialEntry ? 'Edit custom slash command' : 'Create custom slash command');
    this.modalEl.addClass('pivi-create-command-modal');

    new Setting(this.contentEl)
      .setName('Command name')
      .setDesc('The command slug used after / (e.g. Explain, critique)')
      .addText((text) =>
        text
          .setPlaceholder('Explain')
          .setValue(this.commandName)
          .onChange((value) => {
            this.commandName = normalizeCommandName(value);
          })
      );

    new Setting(this.contentEl)
      .setName('Description')
      .setDesc('Description shown in the slash command autocomplete dropdown')
      .addText((text) =>
        text
          .setPlaceholder('Critique the code step-by-step')
          .setValue(this.description)
          .onChange((value) => {
            this.description = value.trim();
          })
      );

    new Setting(this.contentEl)
      .setName('Argument hint')
      .setDesc('Hint text shown in the dropdown (e.g. Code, text)')
      .addText((text) =>
        text
          .setValue(this.argumentHint)
          .onChange((value) => {
            this.argumentHint = value.trim();
          })
      );

    new Setting(this.contentEl)
      .setName('Template prompt')
      .setDesc('Prompt template with variables like {{selected_text}}, {{current_note}}, {{date}}');

    const textareaWrapper = this.contentEl.createDiv({ cls: 'pivi-template-textarea-wrapper' });
    const textarea = textareaWrapper.createEl('textarea', {
      cls: 'pivi-template-textarea',
      attr: {
        rows: '6',
        style: 'width: 100%; font-family: var(--font-monospace); font-size: var(--font-ui-small); box-sizing: border-box;'
      }
    });
    textarea.value = this.templateContent;
    textarea.addEventListener('input', () => {
      this.templateContent = textarea.value;
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Cancel')
          .onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.options.initialEntry ? 'Save' : 'Create')
          .setCta()
          .onClick(async () => {
            if (this.isSaving) {
              return;
            }

            const commandName = normalizeCommandName(this.commandName);
            if (!commandName) {
              new Notice('Please specify a valid command name.');
              return;
            }

            if (!this.templateContent.trim()) {
              new Notice('Please enter a template prompt.');
              return;
            }

            try {
              this.isSaving = true;
              const existingIds = await this.options.getExistingCommandIds?.(this.options.initialEntry);
              if (existingIds?.has(commandName)) {
                new Notice(`A custom command named /${commandName} already exists.`);
                return;
              }

              const entry: SlashCatalogEntry = {
                id: commandName,
                kind: 'command',
                name: commandName,
                description: this.description || `Custom command from ${commandName}.md`,
                argumentHint: this.argumentHint || 'text',
                content: this.templateContent,
                scope: 'vault',
                source: 'user',
                isEditable: true,
                isDeletable: true,
                displayPrefix: '/',
                insertPrefix: '/',
                persistenceKey: this.options.initialEntry?.persistenceKey,
              };

              await this.options.onSave(entry, this.options.initialEntry);
              new Notice(this.options.initialEntry
                ? `Custom command /${commandName} updated.`
                : `Custom command /${commandName} created.`);
              
              this.close();
            } catch (e) {
              console.error('Pivi: Failed to save command template file:', e);
              new Notice('Failed to save the custom slash command.');
            } finally {
              this.isSaving = false;
            }
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
