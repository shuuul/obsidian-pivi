import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
} from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import type { DefaultVaultSkillsPromptActions } from '@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills';
import { Notice } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { obsidianPresentationPlatform } from '@/app/ui/obsidianPresentationPlatform';

export function showDefaultVaultSkillsInstallPrompt(
  actions: DefaultVaultSkillsPromptActions,
): Notice {
  const fragment = activeDocument.win.createFragment();
  const container = fragment.createDiv({ cls: 'pivi-default-skills-notice' });
  const terminology = obsidianPresentationPlatform.getTerminology(appI18n.getLocale());

  container.createEl('p', {
    text: appI18n.t('settings.skills.defaultBundle.desc', {
      hostName: terminology.hostName,
      secureStorageName: terminology.secureStorageName,
      workspaceName: terminology.workspaceName,
    }),
  });
  container.createEl('a', {
    href: DEFAULT_VAULT_SKILLS_REPO_URL,
    text: DEFAULT_VAULT_SKILLS_SLUG,
  });

  const buttons = container.createDiv({ cls: 'pivi-default-skills-notice-actions' });
  const installButton = buttons.createEl('button', {
    attr: { type: 'button' },
    text: appI18n.t('settings.skills.defaultBundle.button'),
  });
  installButton.addEventListener('click', actions.onInstall);

  const dismissButton = buttons.createEl('button', {
    attr: { type: 'button' },
    text: appI18n.t('common.cancel'),
  });
  dismissButton.addEventListener('click', actions.onDismiss);

  return new Notice(fragment, 0);
}
