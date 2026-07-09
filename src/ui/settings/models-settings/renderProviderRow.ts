import { CODEX_OAUTH_PROVIDER_ID } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import {
  deriveProviderReadinessStatus,
  type ProviderReadinessStatusKind,
} from '@pivi/pivi-agent-core/auth/providerReadiness';
import { isProviderDisabled } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { getPiAiModelsForProvider } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry'
import { getProviderLogoSlug } from '@pivi/pivi-agent-core/foundation/providerLogos';
import { Notice } from 'obsidian';

import { testProviderReadiness } from '@/app/workspace/providerReadiness';
import type { TranslationKey } from '@/i18n';
import { t } from '@/i18n';
import { appendProviderLogo } from '@/ui/shared/utils/providerLogoDom';

import { renderProviderCredentialsSection } from './credentialsSection';
import { renderProviderModelChecklist } from './modelChecklist';
import { renderCodexOAuthSection } from './oauthSection';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

const STATUS_LABEL_KEYS: Record<ProviderReadinessStatusKind, TranslationKey> = {
  ready: 'settings.modelsTab.status.ready',
  'missing-credential': 'settings.modelsTab.status.missingCredential',
  'oauth-expired': 'settings.modelsTab.status.oauthExpired',
  disabled: 'settings.modelsTab.status.disabled',
  unavailable: 'settings.modelsTab.status.unavailable',
};

const STATUS_DESC_KEYS: Record<ProviderReadinessStatusKind, TranslationKey> = {
  ready: 'settings.modelsTab.statusDesc.ready',
  'missing-credential': 'settings.modelsTab.statusDesc.missingCredential',
  'oauth-expired': 'settings.modelsTab.statusDesc.oauthExpired',
  disabled: 'settings.modelsTab.statusDesc.disabled',
  unavailable: 'settings.modelsTab.statusDesc.unavailable',
};

export function renderProviderRow(
  providersContainer: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providerId: string,
  getDisplayName: (id: string) => string,
): void {
  const info = getProviderEnvVarNames(providerId);
  const displayName = getDisplayName(providerId);
  const providerDisabled = isProviderDisabled(state.piSettings.disabledProviders, providerId);

  const card = providersContainer.createEl('details', { cls: 'pivi-provider-card' });
  if (providerDisabled) {
    card.addClass('pivi-provider-card-disabled');
  }
  const summary = card.createEl('summary', { cls: 'pivi-provider-header' });

  const titleRow = summary.createDiv({ cls: 'pivi-provider-title-row' });
  const logoSlug = getProviderLogoSlug(providerId);
  if (logoSlug) {
    appendProviderLogo(titleRow, logoSlug, { size: 18, className: 'pivi-provider-card-logo' });
  }
  titleRow.createSpan({ cls: 'pivi-provider-title', text: displayName });

  const codexConnected =
    providerId === CODEX_OAUTH_PROVIDER_ID
      ? (context.plugin.getPiWorkspace()?.providerOAuth?.hasCodexAuth() ?? false)
      : false;
  const credentialStore = context.plugin.getPiWorkspace()?.credentialStore ?? null;
  const providerModelCount = getPiAiModelsForProvider(providerId).length;

  const statusBadge = summary.createSpan({
    cls: 'pivi-provider-status missing-credential',
    text: providerDisabled
      ? t('settings.modelsTab.status.disabled')
      : t('settings.modelsTab.status.missingCredential'),
  });

  const updateStatusBadge = () => {
    const status = deriveProviderReadinessStatus({
      providerId,
      piSettings: state.piSettings,
      credential: credentialStore?.readSync(providerId),
      codexConnected,
      modelCount: providerModelCount,
    });
    statusBadge.setText(t(STATUS_LABEL_KEYS[status.kind]));
    statusBadge.className = `pivi-provider-status ${status.kind}`;
    statusBadge.setAttr('title', t(STATUS_DESC_KEYS[status.kind]));
  };
  updateStatusBadge();

  const disableBtn = summary.createEl('button', {
    cls: 'pivi-provider-disable-btn',
    text: providerDisabled ? t('common.enable') : t('common.disable'),
  });
  disableBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    void (async () => {
      const disabled = new Set(state.piSettings.disabledProviders);
      if (disabled.has(providerId)) {
        disabled.delete(providerId);
      } else {
        disabled.add(providerId);
      }
      state.updatePiSettings({ disabledProviders: [...disabled] });
      await context.plugin.saveSettings();
      context.redisplay();
      for (const view of context.plugin.getAllViews()) {
        view.refreshModelSelector();
      }
    })();
  });

  const removeBtn = summary.createEl('button', {
    cls: 'pivi-provider-remove-btn',
    text: t('common.remove'),
  });
  removeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    void (async () => {
      const added = state.piSettings.addedProviders.filter((p) => p !== providerId);
      const visible = state.piSettings.visibleModels.filter((m) => !m.startsWith(`${providerId}/`));

      state.updatePiSettings({ addedProviders: added, visibleModels: visible });
      await context.plugin.saveSettings();
      context.redisplay();
      new Notice(t('settings.modelsTab.removedProvider', { name: displayName }));
    })();
  });

  const body = card.createDiv({ cls: 'pivi-provider-body' });

  if (providerId === CODEX_OAUTH_PROVIDER_ID) {
    renderCodexOAuthSection(body, context, codexConnected);
  } else {
    renderProviderCredentialsSection(body, context, state, providerId, info, updateStatusBadge);
  }

  renderProviderModelChecklist(body, context, state, providerId);

  const testButton = body.createEl('button', {
    cls: 'pivi-provider-test-btn',
    text: t('settings.modelsTab.testProvider'),
    type: 'button',
  });
  testButton.addEventListener('click', () => {
    void (async () => {
      testButton.disabled = true;
      const previousLabel = testButton.textContent ?? t('settings.modelsTab.testProvider');
      testButton.setText(t('settings.modelsTab.testing'));
      try {
        const result = await testProviderReadiness(providerId, state.piSettings);
        new Notice(
          result.ok
            ? t('settings.modelsTab.testReady', { name: displayName, detail: result.detail })
            : t('settings.modelsTab.testFailed', { name: displayName, detail: result.detail }),
          result.ok ? 8000 : 0,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(t('settings.modelsTab.testError', { name: displayName, message }), 0);
      } finally {
        testButton.disabled = false;
        testButton.setText(previousLabel);
      }
    })();
  });
}
