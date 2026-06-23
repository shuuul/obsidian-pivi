import { Notice, Setting } from 'obsidian';

import { maybeGetPiWorkspaceServices } from '../../app/PiWorkspaceServices';
import type { PiModelsSettingsContext } from './types';

export function renderCodexOAuthSection(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  codexConnected: boolean,
): void {
  const providerOAuth = maybeGetPiWorkspaceServices()?.providerOAuth;

  new Setting(body)
    .setName('OpenAI Codex subscription')
    .setDesc(
      'Sign in with your ChatGPT/Codex subscription. Credentials are stored in .obsius/auth.json (vault-local).',
    )
    .addButton((btn) => {
      btn.setButtonText(codexConnected ? 'Reconnect' : 'Connect');
      btn.onClick(async () => {
        if (!providerOAuth) {
          new Notice('Provider OAUTH is not initialized. Reload the plugin.');
          return;
        }
        btn.setDisabled(true);
        try {
          await providerOAuth.loginCodex((msg) => {
            new Notice(msg, 5000);
          });
          new Notice('OpenAI Codex connected.');
          context.redisplay();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Codex login failed: ${message}`);
        } finally {
          btn.setDisabled(false);
        }
      });
    })
    .addButton((btn) => {
      btn.setButtonText('Disconnect');
      btn.setDisabled(!codexConnected);
      btn.onClick(() => {
        providerOAuth?.logoutCodex();
        new Notice('OpenAI Codex disconnected.');
        context.redisplay();
      });
    });
}
