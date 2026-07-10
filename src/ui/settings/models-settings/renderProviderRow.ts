import { CODEX_OAUTH_PROVIDER_ID } from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import {
  deriveProviderReadinessStatus,
  type ProviderReadinessStatusKind,
} from '@pivi/pivi-agent-core/auth/providerReadiness';
import { isProviderDisabled } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import {
  getLogoSlugForCustomProviderKind,
  getProviderLogoSlug,
} from '@pivi/pivi-agent-core/foundation/providerLogos';
import { Notice } from 'obsidian';

import type { TranslationKey } from '@/i18n';
import { t } from '@/i18n';
import { appendProviderLogo } from '@/ui/shared/utils/providerLogoDom';

import { renderProviderCredentialsSection } from './credentialsSection';
import { renderCustomProviderPanel } from './customProviderPanel';
import {
  isProviderCardExpanded,
  setProviderCardExpanded,
} from './expandedProviderCards';
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
  const customConfig = state.piSettings.customProviders.find((provider) => provider.id === providerId);
  const displayName = customConfig?.name ?? getDisplayName(providerId);
  const providerDisabled = isProviderDisabled(state.piSettings.disabledProviders, providerId);

  const card = providersContainer.createEl('details', { cls: 'pivi-provider-card' });
  if (providerDisabled) {
    card.addClass('pivi-provider-card-disabled');
  }
  if (isProviderCardExpanded(providerId)) {
    card.open = true;
  }
  card.addEventListener('toggle', () => {
    setProviderCardExpanded(providerId, card.open);
  });
  const summary = card.createEl('summary', { cls: 'pivi-provider-header' });

  const titleRow = summary.createDiv({ cls: 'pivi-provider-title-row' });
  const logoSlug = customConfig
    ? getLogoSlugForCustomProviderKind(customConfig.kind) ?? getProviderLogoSlug(providerId)
    : getProviderLogoSlug(providerId);
  if (logoSlug) {
    appendProviderLogo(titleRow, logoSlug, { size: 18, className: 'pivi-provider-card-logo' });
  }
  titleRow.createSpan({ cls: 'pivi-provider-title', text: displayName });

  const codexConnected =
    providerId === CODEX_OAUTH_PROVIDER_ID
      ? (context.plugin.getPiWorkspace()?.providerOAuth?.hasCodexAuth() ?? false)
      : false;
  const credentialStore = context.plugin.getPiWorkspace()?.credentialStore ?? null;
  const providerModelCount = context.plugin.getUiFacades().listModelsForProvider(providerId).length;
  const allowKeyless = !!customConfig && customConfig.apiKeyRequired === false;

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
      allowKeyless,
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
      const customProviders = state.piSettings.customProviders.filter((p) => p.id !== providerId);

      state.updatePiSettings({
        addedProviders: added,
        visibleModels: visible,
        customProviders,
      });
      setProviderCardExpanded(providerId, false);
      context.plugin.getUiFacades().syncCustomProviders(
        context.plugin.settings,
      );
      await context.plugin.saveSettings();
      context.redisplay();
      new Notice(t('settings.modelsTab.removedProvider', { name: displayName }));
    })();
  });

  const body = card.createDiv({ cls: 'pivi-provider-body' });

  if (customConfig) {
    renderCustomProviderPanel(body, context, state, customConfig);
    renderProviderCredentialsSection(
      body,
      context,
      state,
      providerId,
      info,
      updateStatusBadge,
      { allowKeyless },
    );
  } else if (providerId === CODEX_OAUTH_PROVIDER_ID) {
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
        const readiness = context.plugin.getPiWorkspace()?.modelReadinessProvider;
        if (!readiness?.testProvider) {
          new Notice(
            t('settings.modelsTab.testError', {
              name: displayName,
              message: t('settings.modelsTab.readinessProviderUnavailable'),
            }),
            0,
          );
          return;
        }
        const result = await readiness.testProvider(providerId, context.plugin.settings);
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
