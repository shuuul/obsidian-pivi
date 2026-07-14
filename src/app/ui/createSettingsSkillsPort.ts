import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from '@pivi/pivi-agent-core/skills/vault/fetchDefaultVaultSkillsRemoteSha';
import { notifyVaultSkillsChanged } from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';
import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { getLocale, t } from '@/app/i18n';

import { obsidianPresentationPlatform } from './obsidianPresentationPlatform';

export function createSettingsSkillsPort(
  host: PiviSettingsHost,
): SettingsComplexPorts['skills'] {
  const getService = () => {
    const vaultPath = host.getVaultPath();
    if (!vaultPath) throw new Error('Vault path is unavailable.');
    return new VaultSkillsService(vaultPath, { processRunner: host.processRunner });
  };
  return {
    featuredBundle: {
      getDescriptor: () => {
        const terminology = obsidianPresentationPlatform.getTerminology(getLocale());
        return {
          name: t('settings.skills.defaultBundle.name', { hostName: terminology.hostName }),
          description: t('settings.skills.defaultBundle.desc', {
            workspaceName: terminology.workspaceName,
          }),
          source: DEFAULT_VAULT_SKILLS_SLUG,
          sourceUrl: DEFAULT_VAULT_SKILLS_REPO_URL,
        };
      },
      isInstalled: () => {
        const vaultPath = host.getVaultPath();
        return vaultPath
          ? new VaultSkillsService(vaultPath, { processRunner: host.processRunner })
            .list()
            .some(skill => isDefaultVaultSkillFolder(skill.folderName))
          : false;
      },
      async install() {
        const [remoteSha] = await Promise.all([
          fetchDefaultVaultSkillsRemoteSha(host.httpClient),
          getService().installFromSource(DEFAULT_VAULT_SKILLS_SLUG),
        ]);
        host.settings.defaultVaultSkillsSeeded = true;
        delete host.settings.defaultVaultSkillsPromptDismissed;
        delete host.settings.defaultVaultSkillsRemovedFolders;
        if (remoteSha) host.settings.defaultVaultSkillsCommitSha = remoteSha;
        await host.saveSettings();
        await notifyVaultSkillsChanged(host);
      },
      async update() {
        const removedFolders = new Set(host.settings.defaultVaultSkillsRemovedFolders ?? []);
        const [remoteSha] = await Promise.all([
          fetchDefaultVaultSkillsRemoteSha(host.httpClient),
          getService().upgradeDefaultBundle(removedFolders),
        ]);
        host.settings.defaultVaultSkillsSeeded = true;
        if (remoteSha) host.settings.defaultVaultSkillsCommitSha = remoteSha;
        await host.saveSettings();
        await notifyVaultSkillsChanged(host);
      },
    },
    list: () => {
      const vaultPath = host.getVaultPath();
      return vaultPath ? new VaultSkillsService(vaultPath, { processRunner: host.processRunner }).list() : [];
    },
    async listRemote(source) {
      return getService().listRemoteSkills(source);
    },
    async install(source, skillNames) {
      await getService().installFromSource(source, {
        skillNames: skillNames ? [...skillNames] : undefined,
      });
      await notifyVaultSkillsChanged(host);
    },
    async setDisabled(folderName, disabled) {
      getService().setSkillDisabled(folderName, disabled);
      await notifyVaultSkillsChanged(host);
    },
    async remove(folderName) {
      getService().remove(folderName);
      if (isDefaultVaultSkillFolder(folderName)) {
        host.settings.defaultVaultSkillsRemovedFolders = [
          ...new Set([...(host.settings.defaultVaultSkillsRemovedFolders ?? []), folderName]),
        ];
        await host.saveSettings();
      }
      await notifyVaultSkillsChanged(host);
    },
    async updateAll() {
      await getService().updateAll();
      await notifyVaultSkillsChanged(host);
    },
    async update(skillName, folderName) {
      await getService().updateSkill(skillName, folderName);
      await notifyVaultSkillsChanged(host);
    },
  };
}
