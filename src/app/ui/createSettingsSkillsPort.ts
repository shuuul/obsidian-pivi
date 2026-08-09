import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from '@pivi/agent/skills/vault/defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from '@pivi/agent/skills/vault/fetchDefaultVaultSkillsRemoteSha';
import { notifyVaultSkillsChanged } from '@pivi/agent/skills/vault/notifyVaultSkillsChanged';
import type { SkillsManagementCommitResult } from '@pivi/agent/skills/vault/skillsManagementCoordinator';
import type { SkillsManagementCoordinator } from '@pivi/agent/skills/vault/skillsManagementCoordinator';
import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { getLocale, t } from '@/app/i18n';

import { obsidianPresentationPlatform } from './obsidianPresentationPlatform';

export function createSettingsSkillsPort(
  host: PiviSettingsHost,
  workspaceCoordinator: SkillsManagementCoordinator,
): SettingsComplexPorts['skills'] {
  const getCoordinator = (): SkillsManagementCoordinator => workspaceCoordinator;
  const reportCommitOutcome = (result: SkillsManagementCommitResult): void => {
    if (!result.refreshed) {
      host.notify(t('settings.skills.feedback.partialFailure'));
    }
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
          ? getCoordinator().snapshot().skills.some(
            skill => !!skill.folderName && isDefaultVaultSkillFolder(skill.folderName),
          )
          : false;
      },
      async install() {
        const remoteSha = await fetchDefaultVaultSkillsRemoteSha(host.httpClient);
        const result = await getCoordinator().execute(
          { action: 'install', source: DEFAULT_VAULT_SKILLS_SLUG },
          undefined,
          { defaultBundleCommitSha: remoteSha },
        );
        reportCommitOutcome(result);
        await notifyVaultSkillsChanged(host);
      },
      async update() {
        const removedFolders = new Set(host.settings.defaultVaultSkillsRemovedFolders ?? []);
        const remoteSha = await fetchDefaultVaultSkillsRemoteSha(host.httpClient);
        const result = await getCoordinator().updateDefaultBundle(removedFolders, {
          defaultBundleCommitSha: remoteSha,
        });
        reportCommitOutcome(result);
        await notifyVaultSkillsChanged(host);
      },
    },
    list: () => {
      const vaultPath = host.getVaultPath();
      return vaultPath ? getCoordinator().snapshot().skills.map(skill => ({
        name: skill.name,
        description: skill.description ?? '',
        folderName: skill.folderName ?? skill.name,
        disabled: !skill.enabled,
      })) : [];
    },
    async listRemote(source) {
      return (await getCoordinator().listRemote(source)).skills.map(skill => ({
        name: skill.name,
        description: skill.description ?? '',
      }));
    },
    async install(source, skillNames) {
      const result = await getCoordinator().execute({
        action: 'install',
        source,
        skillNames: skillNames ? [...skillNames] : undefined,
      });
      reportCommitOutcome(result);
      await notifyVaultSkillsChanged(host);
    },
    async setDisabled(folderName, disabled) {
      const result = await getCoordinator().execute({ action: 'set_enabled', name: folderName, enabled: !disabled });
      reportCommitOutcome(result);
      await notifyVaultSkillsChanged(host);
    },
    async remove(folderName) {
      const result = await getCoordinator().execute({ action: 'remove', name: folderName });
      reportCommitOutcome(result);
      await notifyVaultSkillsChanged(host);
    },
    async updateAll() {
      const result = await getCoordinator().execute({ action: 'update_all' });
      reportCommitOutcome(result);
      await notifyVaultSkillsChanged(host);
    },
    async update(skillName, folderName) {
      const result = await getCoordinator().execute({ action: 'update', name: folderName || skillName });
      reportCommitOutcome(result);
      await notifyVaultSkillsChanged(host);
    },
  };
}
