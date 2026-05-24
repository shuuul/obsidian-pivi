import { Notice, Setting } from 'obsidian';

import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import { notifyVaultSkillsChanged } from '../skills/notifyVaultSkillsChanged';
import { VaultSkillsService } from '../skills/VaultSkillsService';

const SKILLS_SH_SECURITY_URL = 'https://skills.sh/docs/security';

export function renderPiSkillsSettingsSection(
  container: HTMLElement,
  context: {
    plugin: ObsiusPlugin;
    redisplay: () => void;
  },
): void {
  new Setting(container).setName('Vault skills').setHeading();

  const desc = container.createDiv({ cls: 'obsius2-sp-settings-desc' });
  desc.createEl('p', {
    cls: 'setting-item-description',
    text: 'Agent Skills live in .obsius/skills/ and are loaded on the next turn (skill tool + system prompt). Install from skills.sh using owner/repo.',
  });
  const security = desc.createEl('p', { cls: 'setting-item-description' });
  security.createSpan({ text: 'Review SKILL.md before installing. ' });
  security.createEl('a', {
    text: 'skills.sh security notice',
    href: SKILLS_SH_SECURITY_URL,
  });
  security.createSpan({ text: '.' });

  const vaultPath = getVaultPath(context.plugin.app);
  if (!vaultPath) {
    container.createEl('p', {
      text: 'Open a vault to manage skills.',
      cls: 'obsius2-sp-empty-state',
    });
    return;
  }

  const service = new VaultSkillsService(vaultPath);
  let installSlug = '';
  let installing = false;

  const listHost = container.createDiv({ cls: 'obsius2-skills-list-host' });

  const refreshList = (): void => {
    listHost.empty();

    const header = listHost.createDiv({ cls: 'obsius2-sp-header' });
    header.createSpan({ cls: 'obsius2-sp-label', text: 'Installed skills' });
    const headerActions = header.createDiv({ cls: 'obsius2-sp-header-actions' });
    const refreshBtn = headerActions.createEl('button', {
      cls: 'obsius2-settings-action-btn',
      attr: { type: 'button', 'aria-label': 'Refresh skills list' },
    });
    refreshBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    refreshBtn.addEventListener('click', () => refreshList());

    const skills = service.list();
    if (skills.length === 0) {
      listHost.createEl('p', {
        cls: 'obsius2-sp-empty-state',
        text: 'No skills in .obsius/skills/ yet. Install one below.',
      });
      return;
    }

    const list = listHost.createDiv({ cls: 'obsius2-sp-list' });
    for (const skill of skills) {
      const item = list.createDiv({ cls: 'obsius2-sp-item' });
      const info = item.createDiv({ cls: 'obsius2-sp-info' });
      const itemHeader = info.createDiv({ cls: 'obsius2-sp-item-header' });
      itemHeader.createSpan({ cls: 'obsius2-sp-item-name', text: skill.name });
      itemHeader.createSpan({
        cls: 'obsius2-sp-item-folder',
        text: skill.folderName,
      });
      if (skill.description) {
        info.createDiv({ cls: 'obsius2-sp-item-desc', text: skill.description });
      }

      const removeBtn = item.createEl('button', {
        cls: 'obsius2-settings-action-btn obsius2-settings-delete-btn',
        attr: { type: 'button', 'aria-label': `Remove skill ${skill.name}` },
      });
      removeBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
      removeBtn.addEventListener('click', async () => {
        try {
          service.remove(skill.folderName);
          await notifyVaultSkillsChanged(context.plugin);
          new Notice(`Removed skill "${skill.name}".`);
          refreshList();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Remove failed: ${message}`);
        }
      });
    }
  };

  new Setting(container)
    .setName('Install from skills.sh')
    .setDesc('Slug such as vercel-labs/agent-skills. Runs npx skills add --copy -y, then syncs into .obsius/skills/.')
    .addText((text) => {
      text
        .setPlaceholder('owner/repo')
        .onChange((value) => {
          installSlug = value;
        });
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void runInstall();
        }
      });
    })
    .addButton((button) => {
      button.setButtonText('Install').setCta().onClick(() => {
        void runInstall();
      });
    });

  refreshList();

  async function runInstall(): Promise<void> {
    if (installing) {
      return;
    }
    if (!installSlug.trim()) {
      new Notice('Enter an owner/repo slug.');
      return;
    }

    installing = true;
    const notice = new Notice('Installing skill…', 0);
    try {
      const installed = await service.installFromSlug(installSlug);
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(`Installed: ${installed.join(', ')}`);
      installSlug = '';
      context.redisplay();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Install failed: ${message}`, 8000);
    } finally {
      installing = false;
    }
  }
}
