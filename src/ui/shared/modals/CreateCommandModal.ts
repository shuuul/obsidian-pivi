import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { type App, Modal, Notice, Setting } from 'obsidian';

import { t } from '@/i18n';

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
    this.setTitle(
      this.options.initialEntry
        ? t('settings.createCommand.titleEdit')
        : t('settings.createCommand.titleCreate'),
    );
    this.modalEl.addClass('pivi-create-command-modal');

    new Setting(this.contentEl)
      .setName(t('settings.createCommand.name.name'))
      .setDesc(t('settings.createCommand.name.desc'))
      .addText((text) =>
        text
          .setPlaceholder(t('settings.createCommand.name.placeholder'))
          .setValue(this.commandName)
          .onChange((value) => {
            this.commandName = normalizeCommandName(value);
          })
      );

    new Setting(this.contentEl)
      .setName(t('settings.createCommand.description.name'))
      .setDesc(t('settings.createCommand.description.desc'))
      .addText((text) =>
        text
          .setPlaceholder(t('settings.createCommand.description.placeholder'))
          .setValue(this.description)
          .onChange((value) => {
            this.description = value.trim();
          })
      );

    new Setting(this.contentEl)
      .setName(t('settings.createCommand.argumentHint.name'))
      .setDesc(t('settings.createCommand.argumentHint.desc'))
      .addText((text) =>
        text
          .setValue(this.argumentHint)
          .onChange((value) => {
            this.argumentHint = value.trim();
          })
      );

    new Setting(this.contentEl)
      .setName(t('settings.createCommand.template.name'))
      .setDesc(t('settings.createCommand.template.desc'));

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
          .setButtonText(t('common.cancel'))
          .onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.options.initialEntry ? t('common.save') : t('common.create'))
          .setCta()
          .onClick(async () => {
            if (this.isSaving) {
              return;
            }

            const commandName = normalizeCommandName(this.commandName);
            if (!commandName) {
              new Notice(t('settings.createCommand.needName'));
              return;
            }

            if (!this.templateContent.trim()) {
              new Notice(t('settings.createCommand.needTemplate'));
              return;
            }

            try {
              this.isSaving = true;
              const existingIds = await this.options.getExistingCommandIds?.(this.options.initialEntry);
              if (existingIds?.has(commandName)) {
                new Notice(t('settings.createCommand.duplicate', { name: commandName }));
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
              new Notice(
                this.options.initialEntry
                  ? t('settings.createCommand.updatedNamed', { name: commandName })
                  : t('settings.createCommand.createdNamed', { name: commandName }),
              );

              this.close();
            } catch (e) {
              console.error('Pivi: Failed to save command template file:', e);
              new Notice(t('settings.createCommand.saveFailed'));
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
