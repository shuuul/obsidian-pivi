import { Notice } from 'obsidian';

import { appendProviderLogo } from '../../../shared/providerLogo';
import { maybeGetPiWorkspaceServices } from '../../app/PiWorkspaceServices';
import { getProviderEnvVarNames } from '../../auth/providerEnvVars';
import { CODEX_OAUTH_PROVIDER_ID } from '../../auth/ProviderOAuthService';
import {
  isProviderConfigured,
  isProviderDisabled,
} from '../../auth/ProviderSecretStorage';
import { getProviderLogoSlug } from '../providerLogos';
import { renderProviderCredentialsSection } from './credentialsSection';
import { renderProviderModelChecklist } from './modelChecklist';
import { renderCodexOAuthSection } from './oauthSection';
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

  const card = providersContainer.createEl('details', { cls: 'obsius2-provider-card' });
  if (providerDisabled) {
    card.addClass('obsius2-provider-card-disabled');
  }
  const summary = card.createEl('summary', { cls: 'obsius2-provider-header' });

  const titleRow = summary.createDiv({ cls: 'obsius2-provider-title-row' });
  const logoSlug = getProviderLogoSlug(providerId);
  if (logoSlug) {
    appendProviderLogo(titleRow, logoSlug, { size: 18, className: 'obsius2-provider-card-logo' });
  }
  titleRow.createSpan({ cls: 'obsius2-provider-title', text: displayName });

  const codexConnected =
    providerId === CODEX_OAUTH_PROVIDER_ID
      ? (maybeGetPiWorkspaceServices()?.providerOAuth?.hasCodexAuth() ?? false)
      : false;

  const statusBadge = summary.createSpan({
    cls: 'obsius2-provider-status not-configured',
    text: providerDisabled ? 'Disabled' : 'Not configured',
  });

  const updateStatusBadge = () => {
    const configured = isProviderConfigured(
      state.secretStorage,
      providerId,
      state.piSettings.environmentVariables,
      {
        codexConnected,
        disabledProviders: state.piSettings.disabledProviders,
      },
    );
    if (providerDisabled) {
      statusBadge.setText('Disabled');
      statusBadge.className = 'obsius2-provider-status disabled';
      return;
    }
    statusBadge.setText(configured ? 'Configured' : 'Not configured');
    statusBadge.className = `obsius2-provider-status ${configured ? 'configured' : 'not-configured'}`;
  };
  updateStatusBadge();

  const disableBtn = summary.createEl('button', {
    cls: 'obsius2-provider-disable-btn',
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
    cls: 'obsius2-provider-remove-btn',
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

  const body = card.createDiv({ cls: 'obsius2-provider-body' });

  if (providerId === CODEX_OAUTH_PROVIDER_ID) {
    renderCodexOAuthSection(body, context, codexConnected);
    return;
  }

  renderProviderCredentialsSection(body, context, state, providerId, info, updateStatusBadge);
  renderProviderModelChecklist(body, context, state, providerId);
}
