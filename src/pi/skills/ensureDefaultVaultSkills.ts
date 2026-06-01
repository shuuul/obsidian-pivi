import { Notice } from 'obsidian';

import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import { DEFAULT_VAULT_SKILLS_SLUG } from './defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from './fetchDefaultVaultSkillsRemoteSha';
import { notifyVaultSkillsChanged } from './notifyVaultSkillsChanged';
import { VaultSkillsService } from './VaultSkillsService';

export function shouldSeedDefaultVaultSkills(
  settings: { defaultVaultSkillsSeeded?: boolean },
  installedSkillCount: number,
): boolean {
  if (settings.defaultVaultSkillsSeeded === true) {
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

function getRemovedDefaultFolders(settings: {
  defaultVaultSkillsRemovedFolders?: string[];
}): Set<string> {
  return new Set(settings.defaultVaultSkillsRemovedFolders ?? []);
}

/**
 * First-time install when empty, then on each startup compare kepano/obsidian-skills
 * main commit SHA and upgrade bundle skills when upstream changed.
 */
export async function ensureDefaultVaultSkills(plugin: ObsiusPlugin): Promise<void> {
  const vaultPath = getVaultPath(plugin.app);
  if (!vaultPath) {
    return;
  }

  const remoteSha = await fetchDefaultVaultSkillsRemoteSha();
  if (!remoteSha) {
    return;
  }

  const service = new VaultSkillsService(vaultPath);
  const removedFolders = getRemovedDefaultFolders(plugin.settings);

  if (shouldSeedDefaultVaultSkills(plugin.settings, service.list().length)) {
    const notice = new Notice('Installing default Obsidian skills…', 0);
    try {
      const installed = await service.installFromSlug(DEFAULT_VAULT_SKILLS_SLUG);
      plugin.settings.defaultVaultSkillsSeeded = true;
      plugin.settings.defaultVaultSkillsCommitSha = remoteSha;
      await plugin.saveSettings();
      await notifyVaultSkillsChanged(plugin);
      notice.hide();
      new Notice(
        `Installed default Obsidian skills (${installed.length}).`,
        5000,
      );
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Default skills install failed: ${message}`, 8000);
      throw error;
    }
    return;
  }

  if (!shouldUpgradeDefaultVaultSkills(plugin.settings, remoteSha)) {
    return;
  }

  const notice = new Notice('Updating default Obsidian skills…', 0);
  try {
    const updated = await service.upgradeDefaultBundle(removedFolders);
    plugin.settings.defaultVaultSkillsCommitSha = remoteSha;
    await plugin.saveSettings();
    await notifyVaultSkillsChanged(plugin);
    notice.hide();
    if (updated.length > 0) {
      new Notice(
        `Updated default Obsidian skills (${updated.length}): ${updated.join(', ')}.`,
        6000,
      );
    }
  } catch (error) {
    notice.hide();
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`Default skills update failed: ${message}`, 8000);
    throw error;
  }
}
