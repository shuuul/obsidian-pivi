import { Notice } from 'obsidian';

import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import { CODEX_OAUTH_PROVIDER_ID } from '../../auth/ProviderOAuthService';
import { isProviderDisabled } from '../../auth/ProviderSecretStorage';
import { getPiAiModelsForProvider } from '../PiChatUIConfig';
import { appendProviderLogo } from '../providerLogoDom';
import { getProviderLogoSlug } from '../providerLogos';
import { renderProviderCredentialsSection } from './credentialsSection';
import { renderProviderModelChecklist } from './modelChecklist';
import { renderCodexOAuthSection } from './oauthSection';
import { deriveProviderReadinessStatus } from './providerStatus';
import { testProviderReadiness } from './testProviderReadiness';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

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
      ? (context.plugin.getPiWorkspace()?.providerOAuth.hasCodexAuth() ?? false)
      : false;
  const credentialStore = context.plugin.getPiWorkspace()?.credentialStore ?? null;
  const providerModelCount = getPiAiModelsForProvider(providerId).length;

  const statusBadge = summary.createSpan({
    cls: 'pivi-provider-status missing-credential',
    text: providerDisabled ? 'Disabled' : 'Missing credential',
  });

  const updateStatusBadge = () => {
    const status = deriveProviderReadinessStatus({
      providerId,
      piSettings: state.piSettings,
      credential: credentialStore?.readSync(providerId),
      codexConnected,
      modelCount: providerModelCount,
    });
    statusBadge.setText(status.label);
    statusBadge.className = `pivi-provider-status ${status.kind}`;
    statusBadge.setAttr('title', status.description);
  };
  updateStatusBadge();

  const disableBtn = summary.createEl('button', {
    cls: 'pivi-provider-disable-btn',
    text: providerDisabled ? 'Enable' : 'Disable',
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
    text: 'Remove',
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
      new Notice(`Removed ${displayName} provider.`);
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
    text: 'Test provider',
    type: 'button',
  });
  testButton.addEventListener('click', () => {
    void (async () => {
      testButton.disabled = true;
      const previousLabel = testButton.textContent ?? 'Test provider';
      testButton.setText('Testing…');
      try {
        const result = await testProviderReadiness(providerId, state.piSettings);
        new Notice(
          result.ok ? `${displayName} ready: ${result.detail}` : `${displayName} test failed: ${result.detail}`,
          result.ok ? 8000 : 0,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${displayName} test error: ${message}`, 0);
      } finally {
        testButton.disabled = false;
        testButton.setText(previousLabel);
      }
    })();
  });
}
