import { Notice } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { showDefaultVaultSkillsInstallPrompt } from '@/app/ui/defaultVaultSkillsPrompt';

describe('default Vault Skills prompt', () => {
  it('renders localized actions through the Obsidian owner-realm helpers', () => {
    appI18n.setLocale('en');
    const onInstall = jest.fn();
    const onDismiss = jest.fn();
    jest.mocked(Notice).mockClear();

    showDefaultVaultSkillsInstallPrompt({ onInstall, onDismiss });

    const fragment = jest.mocked(Notice).mock.calls[0]?.[0] as unknown as DocumentFragment;
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(fragment.textContent).toContain('kepano/obsidian-skills');
    const buttons = fragment.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
