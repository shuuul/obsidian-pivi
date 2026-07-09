import { getVaultPath } from '@pivi/obsidian-host/path';
import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import { installDefaultVaultSkills } from '@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills';
import { notifyVaultSkillsChanged } from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';
import { Notice, Setting } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';

import { appendRefreshIcon, appendTrashIcon } from './settingsActionIcons';

const SKILLS_SH_SECURITY_URL = 'https://skills.sh/docs/security';

export function renderPiSkillsSettingsSection(
  container: HTMLElement,
  context: {
    plugin: PiviPlugin;
    redisplay: () => void;
  },
): void {
  const desc = container.createDiv({ cls: 'pivi-sp-settings-desc' });
  desc.createEl('p', {
    cls: 'setting-item-description',
    text: t('settings.skills.intro'),
  });
  const defaultBundle = desc.createEl('p', { cls: 'setting-item-description' });
  defaultBundle.createSpan({ text: `${t('settings.skills.defaultBundle.label')} ` });
  defaultBundle.createEl('a', {
    text: t('settings.skills.defaultBundle.slug'),
    href: DEFAULT_VAULT_SKILLS_REPO_URL,
  });
  defaultBundle.createSpan({ text: `. ${t('settings.skills.defaultBundle.installMore')}` });
  const security = desc.createEl('p', { cls: 'setting-item-description' });
  security.createSpan({ text: `${t('settings.skills.remote.reviewSkillMd')} ` });
  security.createEl('a', {
    text: t('settings.skills.remote.securityNotice'),
    href: SKILLS_SH_SECURITY_URL,
  });
  security.createSpan({ text: '.' });

  const vaultPath = getVaultPath(context.plugin.app);
  if (!vaultPath) {
    container.createEl('p', {
      text: t('settings.skills.vaultRequired'),
      cls: 'pivi-sp-empty-state',
    });
    return;
  }

  const service = new VaultSkillsService(vaultPath, { processRunner: context.plugin.processRunner });
  let installSource = '';
  let remoteSkills: { name: string; description: string }[] = [];
  let selectedRemoteSkillNames = new Set<string>();
  let busy = false;

  const hasDefaultBundleSkill = (): boolean => service
    .list()
    .some((skill) => isDefaultVaultSkillFolder(skill.folderName));

  if (!hasDefaultBundleSkill()) {
    new Setting(container)
      .setName(t('settings.skills.defaultBundle.name'))
      .setDesc(t('settings.skills.defaultBundle.desc'))
      .addButton((button) => {
        button
          .setButtonText(t('settings.skills.defaultBundle.button'))
          .setCta()
          .onClick(() => {
            void runInstallDefaultBundle();
          });
      });
  }

  new Setting(container)
    .setName(t('settings.skills.remote.name'))
    .setDesc(t('settings.skills.remote.desc'))
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
      button.setButtonText(t('settings.skills.remote.listButton')).onClick(() => {
        void runListRemoteSkills();
      });
    });

  const remoteSkillsHost = container.createDiv({ cls: 'pivi-skills-remote-host' });
  const listHost = container.createDiv({ cls: 'pivi-skills-list-host' });

  const refreshList = (): void => {
    listHost.empty();

    const header = listHost.createDiv({ cls: 'pivi-sp-header' });
    header.createSpan({ cls: 'pivi-sp-label', text: t('settings.skills.installed.heading') });
    const headerActions = header.createDiv({ cls: 'pivi-sp-header-actions' });
    const updateAllBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-text-btn',
      text: t('settings.skills.installed.updateAll'),
      attr: { type: 'button', 'aria-label': t('settings.skills.installed.updateAllAria') },
    });
    updateAllBtn.addEventListener('click', () => {
      void runUpdateAll();
    });
    const refreshBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-action-btn',
      attr: { type: 'button', 'aria-label': t('settings.skills.installed.refreshAria') },
    });
    appendRefreshIcon(refreshBtn);
    refreshBtn.addEventListener('click', () => refreshList());

    const skills = service.list();
    if (skills.length === 0) {
      listHost.createEl('p', {
        cls: 'pivi-sp-empty-state',
        text: t('settings.skills.installed.empty'),
      });
      return;
    }

    const list = listHost.createDiv({ cls: 'pivi-sp-list' });
    for (const skill of skills) {
      const item = list.createDiv({ cls: 'pivi-sp-item' });
      const info = item.createDiv({ cls: 'pivi-sp-info' });
      const itemHeader = info.createDiv({ cls: 'pivi-sp-item-header' });
      itemHeader.createSpan({ cls: 'pivi-sp-item-name', text: skill.name });
      itemHeader.createSpan({
        cls: 'pivi-sp-item-folder',
        text: skill.folderName,
      });
      if (skill.disabled) {
        itemHeader.createSpan({ cls: 'pivi-slash-item-badge', text: t('common.disabled') });
      }
      if (skill.description) {
        info.createDiv({ cls: 'pivi-sp-item-desc', text: skill.description });
      }

      const actions = item.createDiv({ cls: 'pivi-sp-item-actions' });
      const toggleBtn = actions.createEl('button', {
        cls: 'pivi-settings-text-btn',
        text: skill.disabled ? t('common.enable') : t('common.disable'),
        attr: {
          type: 'button',
          'aria-label': skill.disabled
            ? t('settings.skills.installed.enableAria', { name: skill.name })
            : t('settings.skills.installed.disableAria', { name: skill.name }),
        },
      });
      toggleBtn.addEventListener('click', () => {
        void runSetSkillDisabled(skill.name, skill.folderName, !skill.disabled);
      });

      const updateBtn = actions.createEl('button', {
        cls: 'pivi-settings-action-btn',
        attr: {
          type: 'button',
          'aria-label': t('settings.skills.installed.updateAria', { name: skill.name }),
        },
      });
      appendRefreshIcon(updateBtn);
      updateBtn.addEventListener('click', () => {
        void runUpdateSkill(skill.name, skill.folderName);
      });

      const removeBtn = actions.createEl('button', {
        cls: 'pivi-settings-action-btn pivi-settings-delete-btn',
        attr: {
          type: 'button',
          'aria-label': t('settings.skills.installed.removeAria', { name: skill.name }),
        },
      });
      appendTrashIcon(removeBtn);
      removeBtn.addEventListener('click', () => {
        void runRemoveSkill(skill.name, skill.folderName);
      });
    }
  };

  renderRemoteSkillsPicker();

  refreshList();

  async function runInstallDefaultBundle(): Promise<void> {
    if (busy) {
      return;
    }

    busy = true;
    try {
      await installDefaultVaultSkills(context.plugin);
      context.redisplay();
    } finally {
      busy = false;
    }
  }

  function renderRemoteSkillsPicker(): void {
    remoteSkillsHost.empty();
    if (remoteSkills.length === 0) {
      return;
    }

    const header = remoteSkillsHost.createDiv({ cls: 'pivi-sp-header' });
    header.createSpan({ cls: 'pivi-sp-label', text: t('settings.skills.remote.heading') });
    const headerActions = header.createDiv({ cls: 'pivi-sp-header-actions' });
    const selectAllBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-text-btn',
      text: t('common.selectAll'),
      attr: { type: 'button', 'aria-label': t('settings.skills.remote.selectAll') },
    });
    selectAllBtn.addEventListener('click', () => {
      selectedRemoteSkillNames = new Set(remoteSkills.map((skill) => skill.name));
      renderRemoteSkillsPicker();
    });
    const clearBtn = headerActions.createEl('button', {
      cls: 'pivi-settings-text-btn',
      text: t('common.clear'),
      attr: { type: 'button', 'aria-label': t('settings.skills.remote.clearSelected') },
    });
    clearBtn.addEventListener('click', () => {
      selectedRemoteSkillNames = new Set();
      renderRemoteSkillsPicker();
    });

    const list = remoteSkillsHost.createDiv({ cls: 'pivi-sp-list pivi-skills-remote-list' });
    for (const skill of remoteSkills) {
      const item = list.createEl('label', { cls: 'pivi-skill-choice' });
      const checkbox = item.createEl('input', {
        type: 'checkbox',
        cls: 'pivi-skill-choice-checkbox',
        attr: { 'aria-label': t('settings.skills.installed.installAria', { name: skill.name }) },
      });
      checkbox.checked = selectedRemoteSkillNames.has(skill.name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedRemoteSkillNames.add(skill.name);
        } else {
          selectedRemoteSkillNames.delete(skill.name);
        }
      });
      const info = item.createSpan({ cls: 'pivi-skill-choice-info' });
      info.createSpan({ cls: 'pivi-sp-item-name', text: skill.name });
      if (skill.description) {
        info.createSpan({ cls: 'pivi-sp-item-desc', text: skill.description });
      }
    }

    const installBtn = remoteSkillsHost.createEl('button', {
      cls: 'mod-cta pivi-skills-install-selected-btn',
      text: t('settings.skills.remote.installSelected'),
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
      new Notice(t('settings.skills.notices.enterSource'));
      return;
    }

    busy = true;
    const notice = new Notice(t('settings.skills.notices.loadingRemote'), 0);
    try {
      remoteSkills = await service.listRemoteSkills(installSource);
      selectedRemoteSkillNames = new Set(remoteSkills.map((skill) => skill.name));
      notice.hide();
      if (remoteSkills.length === 0) {
        new Notice(t('settings.skills.notices.noRemote'), 8000);
      }
      renderRemoteSkillsPicker();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.listFailed', { message }), 8000);
    } finally {
      busy = false;
    }
  }

  async function runInstallSelectedRemoteSkills(): Promise<void> {
    const skillNames = [...selectedRemoteSkillNames];
    if (skillNames.length === 0) {
      new Notice(t('settings.skills.notices.selectOne'));
      return;
    }

    await runInstall(skillNames);
  }

  async function runInstall(skillNames: string[]): Promise<void> {
    if (busy) {
      return;
    }
    if (!installSource.trim()) {
      new Notice(t('settings.skills.notices.enterSource'));
      return;
    }

    busy = true;
    const notice = new Notice(t('settings.skills.notices.installing'), 0);
    try {
      const installed = await service.installFromSource(installSource, {
        skillNames,
      });
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(t('settings.skills.notices.installed', { names: installed.join(', ') }));
      installSource = '';
      remoteSkills = [];
      selectedRemoteSkillNames = new Set();
      context.redisplay();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.installFailed', { message }), 8000);
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
      new Notice(t('settings.skills.notices.removed', { name: skillName }));
      refreshList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.removeFailed', { message }));
    }
  }

  async function runSetSkillDisabled(skillName: string, folderName: string, disabled: boolean): Promise<void> {
    try {
      service.setSkillDisabled(folderName, disabled);
      await notifyVaultSkillsChanged(context.plugin);
      new Notice(
        disabled
          ? t('settings.skills.notices.skillDisabled', { name: skillName })
          : t('settings.skills.notices.skillEnabled', { name: skillName }),
      );
      refreshList();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.updateFailed', { message }));
    }
  }

  async function runUpdateAll(): Promise<void> {
    if (busy) {
      return;
    }

    busy = true;
    const notice = new Notice(t('settings.skills.notices.updatingAll'), 0);
    try {
      const updated = await service.updateAll();
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(
        updated.length > 0
          ? t('settings.skills.notices.updated', { names: updated.join(', ') })
          : t('settings.skills.notices.upToDateAll'),
      );
      refreshList();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.updateFailed', { message }), 8000);
    } finally {
      busy = false;
    }
  }

  async function runUpdateSkill(skillName: string, folderName: string): Promise<void> {
    if (busy) {
      return;
    }

    busy = true;
    const notice = new Notice(t('settings.skills.notices.updatingOne', { name: skillName }), 0);
    try {
      const updated = await service.updateSkill(skillName, folderName);
      await notifyVaultSkillsChanged(context.plugin);
      notice.hide();
      new Notice(
        updated.length > 0
          ? t('settings.skills.notices.updated', { names: updated.join(', ') })
          : t('settings.skills.notices.upToDateOne', { name: skillName }),
      );
      refreshList();
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('settings.skills.notices.updateFailed', { message }), 8000);
    } finally {
      busy = false;
    }
  }
}
