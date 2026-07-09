import { Notice, Setting } from 'obsidian';

import { t } from '@/i18n';

import type { PiModelsSettingsContext } from './types';

export function renderCodexOAuthSection(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  codexConnected: boolean,
): void {
  const providerOAuth = context.plugin.getPiWorkspace()?.providerOAuth;

  new Setting(body)
    .setName(t('settings.modelsTab.codex.name'))
    .setDesc(t('settings.modelsTab.codex.desc'))
    .addButton((btn) => {
      btn.setButtonText(
        codexConnected
          ? t('settings.modelsTab.codex.reconnect')
          : t('settings.modelsTab.codex.connect'),
      );
      btn.onClick(async () => {
        if (!providerOAuth) {
          new Notice(t('settings.modelsTab.codex.notInitialized'));
          return;
        }
        btn.setDisabled(true);
        try {
          await providerOAuth.loginCodex((msg) => {
            new Notice(msg, 5000);
          });
          new Notice(t('settings.modelsTab.codex.connected'));
          refreshSlashCommandCatalogs(context);
          context.redisplay();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('settings.modelsTab.codex.loginFailed', { message }));
        } finally {
          btn.setDisabled(false);
        }
      });
    })
    .addButton((btn) => {
      btn.setButtonText(t('settings.modelsTab.codex.disconnect'));
      btn.setDisabled(!codexConnected);
      btn.onClick(() => {
        providerOAuth?.logoutCodex();
        new Notice(t('settings.modelsTab.codex.disconnected'));
        refreshSlashCommandCatalogs(context);
        context.redisplay();
      });
    });
}

function refreshSlashCommandCatalogs(context: PiModelsSettingsContext): void {
  for (const view of context.plugin.getAllViews()) {
    view.invalidateSlashCommandCaches();
  }
}
