import { type App, Modal, Notice, Setting } from 'obsidian';

import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type PiviPlugin from '../../main';

export class CreateCommandModal extends Modal {
  private commandName = '';
  private description = '';
  private argumentHint = 'text';
  private templateContent = 'Please analyze the following:\n{{selected_text}}';

  constructor(app: App, private readonly plugin: PiviPlugin) {
    super(app);
  }

  onOpen() {
    this.setTitle('Create custom slash command');
    this.modalEl.addClass('pivi-create-command-modal');

    new Setting(this.contentEl)
      .setName('Command name')
      .setDesc('The command slug used after / (e.g. Explain, critique)')
      .addText((text) =>
        text
          .setPlaceholder('Explain')
          .onChange((value) => {
            this.commandName = value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
          })
      );

    new Setting(this.contentEl)
      .setName('Description')
      .setDesc('Description shown in the slash command autocomplete dropdown')
      .addText((text) =>
        text
          .setPlaceholder('Critique the code step-by-step')
          .onChange((value) => {
            this.description = value.trim();
          })
      );

    new Setting(this.contentEl)
      .setName('Argument hint')
      .setDesc('Hint text shown in the dropdown (e.g. Code, text)')
      .addText((text) =>
        text
          .setValue('text')
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
      text: this.templateContent,
      attr: {
        rows: '6',
        style: 'width: 100%; font-family: var(--font-monospace); font-size: var(--font-ui-small); box-sizing: border-box;'
      }
    });
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
          .setButtonText('Create')
          .setCta()
          .onClick(async () => {
            if (!this.commandName) {
              new Notice('Please specify a valid command name.');
              return;
            }

            try {
              const path = `.pivi/templates/${this.commandName}.md`;
              const fileContent = `---
description: ${this.description || `Custom template from ${this.commandName}.md`}
argumentHint: ${this.argumentHint}
---
${this.templateContent}`;
              
              const adapter = this.plugin.storage.getAdapter();
              await adapter.ensureFolder('.pivi/templates');
              await adapter.write(path, fileContent);
              
              new Notice(`Custom command /${this.commandName} successfully created!`);
              
              const catalog = AgentWorkspace.getServices()?.slashCommandCatalog;
              if (catalog) {
                await catalog.refresh();
              }
              
              this.close();
            } catch (e) {
              console.error('Pivi: Failed to save command template file:', e);
              new Notice('Failed to create the custom slash command.');
            }
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
