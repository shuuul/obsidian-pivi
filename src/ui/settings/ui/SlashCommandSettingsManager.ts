import type { SlashCommandCatalog } from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { type App, Notice, setIcon } from 'obsidian';

import { t } from '@/i18n';
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
      text: t('settings.slashCommandsUi.loading'),
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
        text: t('settings.slashCommandsUi.loadFailed', { message }),
      });
    }
  }

  private renderList(entries: SlashCatalogEntry[]): void {
    this.container.empty();

    const header = this.container.createDiv({ cls: 'pivi-sp-header' });
    header.createSpan({ cls: 'pivi-sp-label', text: t('settings.slashCommandsUi.heading') });
    const headerActions = header.createDiv({ cls: 'pivi-sp-header-actions' });
    const addBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-text-btn',
      text: t('settings.slashCommandsUi.add'),
      attr: { type: 'button', 'aria-label': t('settings.slashCommandsUi.addAria') },
    });
    addBtn.addEventListener('click', () => this.openCommandModal());

    if (entries.length === 0) {
      this.container.createEl('p', {
        cls: 'pivi-sp-empty-state',
        text: t('settings.slashCommandsUi.empty'),
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
        attr: { type: 'button', 'aria-label': t('settings.slashCommandsUi.editAria', { name: entry.name }) },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', () => this.openCommandModal(entry));

      const deleteBtn = actions.createEl('button', {
        cls: 'pivi-settings-action-btn pivi-settings-delete-btn',
        attr: { type: 'button', 'aria-label': t('settings.slashCommandsUi.deleteAria', { name: entry.name }) },
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
      t('settings.slashCommandsUi.deleteConfirm', { name: entry.name }),
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.options.catalog.deleteVaultEntry(entry);
      await this.options.onCommandsChanged();
      new Notice(t('settings.slashCommandsUi.deleted', { name: entry.name }));
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.slashCommandsUi.deleteFailed', { message }));
    }
  }
}
