import type { SlashCommandCatalog } from '@pivi/skills/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/skills/commands/SlashCommandEntry';
import { type App, Notice, setIcon } from 'obsidian';

import { confirmDelete } from '@/ui/shared/modals/ConfirmModal';
import { CreateCommandModal } from '@/ui/shared/modals/CreateCommandModal';

export interface SlashCommandSettingsManagerOptions {
  app: App;
  catalog: SlashCommandCatalog;
  onCommandsChanged: () => void | Promise<void>;
}

export class SlashCommandSettingsManager {
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: SlashCommandSettingsManagerOptions,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.container.empty();
  }

  render(): void {
    this.container.empty();
    const loading = this.container.createEl('p', {
      cls: 'pivi-sp-empty-state',
      text: 'Loading custom commands…',
    });

    void this.refresh().finally(() => loading.remove());
  }

  private async refresh(): Promise<void> {
    try {
      await this.options.catalog.refresh();
      const entries = await this.options.catalog.listVaultEntries();
      if (this.disposed) {
        return;
      }
      this.renderList(entries);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.container.empty();
      this.container.createEl('p', {
        cls: 'pivi-sp-empty-state',
        text: `Failed to load custom commands: ${message}`,
      });
    }
  }

  private renderList(entries: SlashCatalogEntry[]): void {
    this.container.empty();

    const header = this.container.createDiv({ cls: 'pivi-sp-header' });
    header.createSpan({ cls: 'pivi-sp-label', text: 'Custom commands' });
    const headerActions = header.createDiv({ cls: 'pivi-sp-header-actions' });
    const addBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-text-btn',
      text: 'Add command',
      attr: { type: 'button', 'aria-label': 'Add custom command' },
    });
    addBtn.addEventListener('click', () => this.openCommandModal());

    if (entries.length === 0) {
      this.container.createEl('p', {
        cls: 'pivi-sp-empty-state',
        text: 'No custom commands yet. Add one to make it available from the / menu.',
      });
      return;
    }

    const list = this.container.createDiv({ cls: 'pivi-sp-list' });
    for (const entry of entries) {
      const item = list.createDiv({ cls: 'pivi-sp-item' });
      const info = item.createDiv({ cls: 'pivi-sp-info' });
      const itemHeader = info.createDiv({ cls: 'pivi-sp-item-header' });
      itemHeader.createSpan({ cls: 'pivi-sp-item-name', text: `/${entry.name}` });
      if (entry.argumentHint) {
        itemHeader.createSpan({ cls: 'pivi-slash-item-hint', text: entry.argumentHint });
      }
      itemHeader.createSpan({
        cls: 'pivi-slash-item-badge',
        text: entry.persistenceKey?.startsWith('legacy-template:') ? 'legacy' : 'vault',
      });
      if (entry.description) {
        info.createDiv({ cls: 'pivi-sp-item-desc', text: entry.description });
      }

      const actions = item.createDiv({ cls: 'pivi-sp-item-actions' });
      const editBtn = actions.createEl('button', {
        cls: 'pivi-settings-action-btn',
        attr: { type: 'button', 'aria-label': `Edit command ${entry.name}` },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', () => this.openCommandModal(entry));

      const deleteBtn = actions.createEl('button', {
        cls: 'pivi-settings-action-btn pivi-settings-delete-btn',
        attr: { type: 'button', 'aria-label': `Delete command ${entry.name}` },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', () => {
        void this.deleteCommand(entry);
      });
    }
  }

  private openCommandModal(entry?: SlashCatalogEntry): void {
    new CreateCommandModal(this.options.app, {
      initialEntry: entry,
      getExistingCommandIds: async (currentEntry) => this.getExistingCommandIds(currentEntry),
      onSave: async (nextEntry, previousEntry) => {
        await this.options.catalog.saveVaultEntry(nextEntry);
        if (previousEntry && previousEntry.id !== nextEntry.id) {
          await this.options.catalog.deleteVaultEntry(previousEntry);
        }
        await this.options.onCommandsChanged();
        await this.refresh();
      },
    }).open();
  }

  private async getExistingCommandIds(currentEntry?: SlashCatalogEntry): Promise<Set<string>> {
    await this.options.catalog.refresh();
    const entries = await this.options.catalog.listDropdownEntries({ includeBuiltIns: true });
    return new Set(
      entries
        .filter((entry) => !(
          entry.scope === 'vault'
          && entry.id === currentEntry?.id
          && entry.persistenceKey === currentEntry?.persistenceKey
        ))
        .map((entry) => entry.id),
    );
  }

  private async deleteCommand(entry: SlashCatalogEntry): Promise<void> {
    const confirmed = await confirmDelete(
      this.options.app,
      `Delete custom command /${entry.name}?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.options.catalog.deleteVaultEntry(entry);
      await this.options.onCommandsChanged();
      new Notice(`Deleted custom command /${entry.name}.`);
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to delete custom command: ${message}`);
    }
  }
}
