import type { PiviSettings } from "@pivi/agent/foundation";
import {
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from "@pivi/agent/skills/vault/defaultVaultSkills";
import type { SkillsManagementMetadataPort } from "@pivi/agent/skills/vault/skillsManagementCoordinator";

/** Narrow host slice required for default-bundle bookkeeping. */
export interface VaultSkillsMetadataHost {
  readonly settings: PiviSettings;
  saveSettings(): Promise<void>;
}

/**
 * Product-owned default-bundle bookkeeping for the skills coordinator. The
 * coordinator invokes this inside the filesystem publication transaction
 * (afterPublish), so a throw rolls the skill tree back; settings mutations are
 * compensated before rethrowing so a failed save never leaves half-applied
 * metadata behind.
 */
export function createVaultSkillsMetadataPort(
  host: VaultSkillsMetadataHost,
): SkillsManagementMetadataPort {
  return {
    async mutationPublished(mutation, metadataContext) {
      if (metadataContext?.defaultBundleUpdate) {
        const previousSeeded = host.settings.defaultVaultSkillsSeeded;
        const previousSha = host.settings.defaultVaultSkillsCommitSha;
        host.settings.defaultVaultSkillsSeeded = true;
        if (metadataContext.defaultBundleCommitSha) {
          host.settings.defaultVaultSkillsCommitSha = metadataContext.defaultBundleCommitSha;
        }
        try {
          await host.saveSettings();
        } catch (error) {
          host.settings.defaultVaultSkillsSeeded = previousSeeded;
          if (previousSha !== undefined) host.settings.defaultVaultSkillsCommitSha = previousSha;
          else delete host.settings.defaultVaultSkillsCommitSha;
          throw error;
        }
        return;
      }
      if (mutation.action === "remove" && isDefaultVaultSkillFolder(mutation.name)) {
        const previous = host.settings.defaultVaultSkillsRemovedFolders;
        host.settings.defaultVaultSkillsRemovedFolders = [
          ...new Set([...(host.settings.defaultVaultSkillsRemovedFolders ?? []), mutation.name]),
        ];
        try {
          await host.saveSettings();
        } catch (error) {
          if (previous !== undefined) host.settings.defaultVaultSkillsRemovedFolders = previous;
          else delete host.settings.defaultVaultSkillsRemovedFolders;
          throw error;
        }
        return;
      }
      if (mutation.action === "install" && mutation.source === DEFAULT_VAULT_SKILLS_SLUG) {
        const previous = {
          seeded: host.settings.defaultVaultSkillsSeeded,
          dismissed: host.settings.defaultVaultSkillsPromptDismissed,
          removed: host.settings.defaultVaultSkillsRemovedFolders,
          commitSha: host.settings.defaultVaultSkillsCommitSha,
        };
        host.settings.defaultVaultSkillsSeeded = true;
        delete host.settings.defaultVaultSkillsPromptDismissed;
        delete host.settings.defaultVaultSkillsRemovedFolders;
        if (metadataContext?.defaultBundleCommitSha) {
          host.settings.defaultVaultSkillsCommitSha = metadataContext.defaultBundleCommitSha;
        }
        try {
          await host.saveSettings();
        } catch (error) {
          host.settings.defaultVaultSkillsSeeded = previous.seeded;
          if (previous.dismissed !== undefined) {
            host.settings.defaultVaultSkillsPromptDismissed = previous.dismissed;
          } else {
            delete host.settings.defaultVaultSkillsPromptDismissed;
          }
          if (previous.removed !== undefined) {
            host.settings.defaultVaultSkillsRemovedFolders = previous.removed;
          } else {
            delete host.settings.defaultVaultSkillsRemovedFolders;
          }
          if (previous.commitSha !== undefined) {
            host.settings.defaultVaultSkillsCommitSha = previous.commitSha;
          } else {
            delete host.settings.defaultVaultSkillsCommitSha;
          }
          throw error;
        }
      }
    },
  };
}
