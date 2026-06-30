import { Notice } from 'obsidian';

import type PiviPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import { loadVaultSkills } from '../context/loadContextLayers';
import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
} from './defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from './fetchDefaultVaultSkillsRemoteSha';
import { notifyVaultSkillsChanged } from './notifyVaultSkillsChanged';
import { VaultSkillsService } from './VaultSkillsService';

export function shouldSeedDefaultVaultSkills(
  settings: {
    defaultVaultSkillsSeeded?: boolean;
    defaultVaultSkillsPromptDismissed?: boolean;
  },
  installedSkillCount: number,
): boolean {
  if (settings.defaultVaultSkillsSeeded === true) {
    return false;
  }
  if (settings.defaultVaultSkillsPromptDismissed === true) {
    return false;
  }
  return installedSkillCount === 0;
}

export function shouldUpgradeDefaultVaultSkills(
  settings: {
    defaultVaultSkillsSeeded?: boolean;
    defaultVaultSkillsCommitSha?: string;
  },
  remoteSha: string,
): boolean {
  if (settings.defaultVaultSkillsSeeded !== true) {
    return false;
  }
  return settings.defaultVaultSkillsCommitSha !== remoteSha;
}

let defaultSkillsPromptVisible = false;

function getDefaultSkillsPromptDocument(): Document | null {
  if (typeof activeDocument !== 'undefined') {
    return activeDocument;
  }
  if (typeof window !== 'undefined' && window.document) {
    return window.document;
  }
  return null;
}

function createDefaultSkillsPromptFragment(
  onInstall: () => void,
  onDismiss: () => void,
): DocumentFragment | null {
  const ownerDocument = getDefaultSkillsPromptDocument();
  if (!ownerDocument) {
    return null;
  }
  const fragment = ownerDocument.createDocumentFragment();
  const container = ownerDocument.createElement('div');
  container.className = 'pivi-default-skills-notice';

  const message = ownerDocument.createElement('p');
  message.textContent = 'Pivi can install the default Obsidian skills bundle for this vault. This will access GitHub/skills.sh, run npx skills, and write files under .pivi/skills/.';
  container.appendChild(message);

  const link = ownerDocument.createElement('a');
  link.href = DEFAULT_VAULT_SKILLS_REPO_URL;
  link.textContent = DEFAULT_VAULT_SKILLS_SLUG;
  container.appendChild(link);

  const actions = ownerDocument.createElement('div');
  actions.className = 'pivi-default-skills-notice-actions';

  const installButton = ownerDocument.createElement('button');
  installButton.type = 'button';
  installButton.textContent = 'Install default skills';
  installButton.addEventListener('click', onInstall);
  actions.appendChild(installButton);

  const dismissButton = ownerDocument.createElement('button');
  dismissButton.type = 'button';
  dismissButton.textContent = 'Not now';
  dismissButton.addEventListener('click', onDismiss);
  actions.appendChild(dismissButton);

  container.appendChild(actions);
  fragment.appendChild(container);
  return fragment;
}

async function rememberDefaultSkillsPromptDismissed(plugin: PiviPlugin): Promise<void> {
  plugin.settings.defaultVaultSkillsPromptDismissed = true;
  await plugin.saveSettings();
}

export async function installDefaultVaultSkills(plugin: PiviPlugin): Promise<string[]> {
  const vaultPath = getVaultPath(plugin.app);
  if (!vaultPath) {
    throw new Error('Open a vault to install default Obsidian skills.');
  }

  const service = new VaultSkillsService(vaultPath);
  const notice = new Notice('Installing default Obsidian skills…', 0);
  try {
    const [remoteSha, installed] = await Promise.all([
      fetchDefaultVaultSkillsRemoteSha(),
      service.installFromSlug(DEFAULT_VAULT_SKILLS_SLUG),
    ]);
    plugin.settings.defaultVaultSkillsSeeded = true;
    delete plugin.settings.defaultVaultSkillsPromptDismissed;
    if (remoteSha) {
      plugin.settings.defaultVaultSkillsCommitSha = remoteSha;
    }
    await plugin.saveSettings();
    await notifyVaultSkillsChanged(plugin);
    notice.hide();
    new Notice(
      `Installed default Obsidian skills (${installed.length}).`,
      5000,
    );
    return installed;
  } catch (error) {
    notice.hide();
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`Default skills install failed: ${message}`, 8000);
    throw error;
  }
}

function showDefaultVaultSkillsInstallPrompt(plugin: PiviPlugin): void {
  if (defaultSkillsPromptVisible) {
    return;
  }
  defaultSkillsPromptVisible = true;

  let notice: Notice | null = null;
  const closeNotice = (): void => {
    defaultSkillsPromptVisible = false;
    notice?.hide();
    notice = null;
  };
  const fragment = createDefaultSkillsPromptFragment(
    () => {
      closeNotice();
      void installDefaultVaultSkills(plugin).catch(() => {
        // installDefaultVaultSkills already surfaces the failure to the user.
      });
    },
    () => {
      closeNotice();
      void rememberDefaultSkillsPromptDismissed(plugin).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Pivi: failed to save default skills prompt dismissal', message);
      });
    },
  );

  if (!fragment) {
    defaultSkillsPromptVisible = false;
    return;
  }

  notice = new Notice(fragment, 0);
}

/**
 * First-time default skills setup is opt-in. Startup may show a confirmation
 * prompt, but installing/updating skills only happens after a user action.
 */
export function ensureDefaultVaultSkills(plugin: PiviPlugin): Promise<void> {
  return Promise.resolve().then(() => {
    const vaultPath = getVaultPath(plugin.app);
    if (!vaultPath) {
      return;
    }

    const installedSkillCount = loadVaultSkills(vaultPath).skills.length;
    if (shouldSeedDefaultVaultSkills(plugin.settings, installedSkillCount)) {
      showDefaultVaultSkillsInstallPrompt(plugin);
    }
  });
}
