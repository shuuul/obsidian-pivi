import { Notice, Setting } from 'obsidian';

import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from '../skills/defaultVaultSkills';
import { notifyVaultSkillsChanged } from '../skills/notifyVaultSkillsChanged';
import { VaultSkillsService } from '../skills/VaultSkillsService';
import { appendRefreshIcon, appendTrashIcon } from './settingsActionIcons';

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
    text: 'Agent Skills live in .obsius/skills/ and are loaded on the next turn (skill tool + system prompt). Obsius installs and checks the default Obsidian skills bundle on startup; you can remove any skill below.',
  });
  const defaultBundle = desc.createEl('p', { cls: 'setting-item-description' });
  defaultBundle.createSpan({ text: 'Default bundle: ' });
  defaultBundle.createEl('a', {
    text: 'kepano/obsidian-skills',
    href: DEFAULT_VAULT_SKILLS_REPO_URL,
  });
  defaultBundle.createSpan({ text: '. Install more from skills.sh using owner/repo.' });
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
  let installSource = '';
  let remoteSkills: { name: string; description: string }[] = [];
  let selectedRemoteSkillNames = new Set<string>();
  let busy = false;

  const listHost = container.createDiv({ cls: 'obsius2-skills-list-host' });
  const remoteSkillsHost = container.createDiv({ cls: 'obsius2-skills-remote-host' });

  const refreshList = (): void => {
    listHost.empty();

    const header = listHost.createDiv({ cls: 'obsius2-sp-header' });
    header.createSpan({ cls: 'obsius2-sp-label', text: 'Installed skills' });
    const headerActions = header.createDiv({ cls: 'obsius2-sp-header-actions' });
    const updateAllBtn = headerActions.createEl('button', {
      cls: 'obsius2-settings-text-btn',
      text: 'Update all',
      attr: { type: 'button', 'aria-label': 'Update all skills' },
    });
    updateAllBtn.addEventListener('click', () => {
      void runUpdateAll();
    });
    const refreshBtn = headerActions.createEl('button', {
      cls: 'obsius2-settings-action-btn',
      attr: { type: 'button', 'aria-label': 'Refresh skills list' },
    });
    appendRefreshIcon(refreshBtn);
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

      const actions = item.createDiv({ cls: 'obsius2-sp-item-actions' });
      const updateBtn = actions.createEl('button', {
        cls: 'obsius2-settings-action-btn',
        attr: { type: 'button', 'aria-label': `Update skill ${skill.name}` },
      });
      appendRefreshIcon(updateBtn);
      updateBtn.addEventListener('click', () => {
        void runUpdateSkill(skill.name, skill.folderName);
      });

      const removeBtn = actions.createEl('button', {
        cls: 'obsius2-settings-action-btn obsius2-settings-delete-btn',
        attr: { type: 'button', 'aria-label': `Remove skill ${skill.name}` },
      });
      appendTrashIcon(removeBtn);
      removeBtn.addEventListener('click', () => {
        void runRemoveSkill(skill.name, skill.folderName);
      });
    }
  };

  new Setting(container)
    .setName('Install from remote')
    .setDesc('Accepts owner/repo, GitHub URLs, git URLs, repo tree URLs, or local paths. First list remote skills, then choose which ones to install.')
    .addText((text) => {
      text
        .setPlaceholder(DEFAULT_VAULT_SKILLS_SLUG)
        .onChange((value) => {
          installSource = value;
          remoteSkills = [];
          selectedRemoteSkillNames = new Set();
          renderRemoteSkillsPicker();
        });
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void runListRemoteSkills();
        }
      });
    })
    .addButton((button) => {
      button.setButtonText('List skills').onClick(() => {
        void runListRemoteSkills();
      });
    });

  renderRemoteSkillsPicker();

  refreshList();

  function renderRemoteSkillsPicker(): void {
    remoteSkillsHost.empty();
    if (remoteSkills.length === 0) {
      return;
    }

    const header = remoteSkillsHost.createDiv({ cls: 'obsius2-sp-header' });
    header.createSpan({ cls: 'obsius2-sp-label', text: 'Remote skills' });
    const headerActions = header.createDiv({ cls: 'obsius2-sp-header-actions' });
    const selectAllBtn = headerActions.createEl('button', {
      cls: 'obsius2-settings-text-btn',
      text: 'Select all',
      attr: { type: 'button', 'aria-label': 'Select all remote skills' },
    });
    selectAllBtn.addEventListener('click', () => {
      selectedRemoteSkillNames = new Set(remoteSkills.map((skill) => skill.name));
      renderRemoteSkillsPicker();
    });
    const clearBtn = headerActions.createEl('button', {
      cls: 'obsius2-settings-text-btn',
      text: 'Clear',
      attr: { type: 'button', 'aria-label': 'Clear selected remote skills' },
    });
    clearBtn.addEventListener('click', () => {
      selectedRemoteSkillNames = new Set();
      renderRemoteSkillsPicker();
    });

    const list = remoteSkillsHost.createDiv({ cls: 'obsius2-sp-list obsius2-skills-remote-list' });
    for (const skill of remoteSkills) {
      const item = list.createEl('label', { cls: 'obsius2-skill-choice' });
      const checkbox = item.createEl('input', {
        type: 'checkbox',
        cls: 'obsius2-skill-choice-checkbox',
        attr: { 'aria-label': `Install skill ${skill.name}` },
      });
      checkbox.checked = selectedRemoteSkillNames.has(skill.name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedRemoteSkillNames.add(skill.name);
        } else {
          selectedRemoteSkillNames.delete(skill.name);
        }
      });
      const info = item.createSpan({ cls: 'obsius2-skill-choice-info' });
      info.createSpan({ cls: 'obsius2-sp-item-name', text: skill.name });
      if (skill.description) {
        info.createSpan({ cls: 'obsius2-sp-item-desc', text: skill.description });
      }
    }

    const installBtn = remoteSkillsHost.createEl('button', {
      cls: 'mod-cta obsius2-skills-install-selected-btn',
      text: 'Install selected skills',
      attr: { type: 'button' },
    });
    installBtn.addEventListener('click', () => {
      void runInstallSelectedRemoteSkills();
    });
  }

  async function runListRemoteSkills(): Promise<void> {
    if (busy) {
      return;
    }
    if (!installSource.trim()) {
      new Notice('Enter a skills source.');
      return;
    }

    busy = true;
    const notice = new Notice('Loading remote skills…', 0);
    try {
      remoteSkills = await service.listRemoteSkills(installSource);
      selectedRemoteSkillNames = new Set(remoteSkills.map((skill) => skill.name));
      notice.hide();
      if (remoteSkills.length === 0) {
        new Notice('No remote skills found for this source.', 8000);
      }
      renderRemoteSkillsPicker();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`List failed: ${message}`, 8000);
    } finally {
      busy = false;
    }
  }

  async function runInstallSelectedRemoteSkills(): Promise<void> {
    const skillNames = [...selectedRemoteSkillNames];
    if (skillNames.length === 0) {
      new Notice('Select at least one skill to install.');
      return;
    }

    await runInstall(skillNames);
  }

  async function runInstall(skillNames: string[]): Promise<void> {
    if (busy) {
      return;
    }
    if (!installSource.trim()) {
      new Notice('Enter a skills source.');
      return;
    }

    busy = true;
    const notice = new Notice('Installing skill…', 0);
    try {
      const installed = await service.installFromSource(installSource, {
        skillNames,
      });
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(`Installed: ${installed.join(', ')}`);
      installSource = '';
      remoteSkills = [];
      selectedRemoteSkillNames = new Set();
      context.redisplay();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Install failed: ${message}`, 8000);
    } finally {
      busy = false;
    }
  }

  async function runRemoveSkill(skillName: string, folderName: string): Promise<void> {
    try {
      service.remove(folderName);
      if (isDefaultVaultSkillFolder(folderName)) {
        const removed = new Set(
          context.plugin.settings.defaultVaultSkillsRemovedFolders ?? [],
        );
        removed.add(folderName);
        context.plugin.settings.defaultVaultSkillsRemovedFolders = [...removed];
        await context.plugin.saveSettings();
      }
      await notifyVaultSkillsChanged(context.plugin);
      new Notice(`Removed skill "${skillName}".`);
      refreshList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Remove failed: ${message}`);
    }
  }

  async function runUpdateAll(): Promise<void> {
    if (busy) {
      return;
    }

    busy = true;
    const notice = new Notice('Updating all skills…', 0);
    try {
      const updated = await service.updateAll();
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(updated.length > 0 ? `Updated: ${updated.join(', ')}` : 'Skills are up to date.');
      refreshList();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Update failed: ${message}`, 8000);
    } finally {
      busy = false;
    }
  }

  async function runUpdateSkill(skillName: string, folderName: string): Promise<void> {
    if (busy) {
      return;
    }

    busy = true;
    const notice = new Notice(`Updating ${skillName}…`, 0);
    try {
      const updated = await service.updateSkill(skillName, folderName);
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(updated.length > 0 ? `Updated: ${updated.join(', ')}` : `${skillName} is up to date.`);
      refreshList();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Update failed: ${message}`, 8000);
    } finally {
      busy = false;
    }
  }
}
