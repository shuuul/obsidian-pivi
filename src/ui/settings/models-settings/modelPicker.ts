import { getProviderLogoSlug } from '@pivi/pivi-agent-core/foundation/providerLogos';
import { Notice } from 'obsidian';

import { t } from '@/i18n';
import { appendProviderLogo } from '@/ui/shared/utils/providerLogoDom';

import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderAddProviderPicker(
  container: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providersNotAdded: string[],
  getDisplayName: (id: string) => string,
): void {
  if (providersNotAdded.length === 0) {
    return;
  }

  const addControls = container.createDiv({ cls: 'pivi-provider-add-controls' });
  const pickerContainer = addControls.createDiv({ cls: 'pivi-provider-add-container' });

  const pickerTrigger = pickerContainer.createEl('button', {
    cls: 'pivi-provider-add-trigger',
    type: 'button',
    text: t('settings.modelsTab.addProvider'),
  });

  const pickerDropdown = pickerContainer.createDiv({ cls: 'pivi-provider-add-dropdown' });

  for (const prov of providersNotAdded) {
    const option = pickerDropdown.createDiv({ cls: 'pivi-provider-add-option' });
    const slug = getProviderLogoSlug(prov);
    if (slug) {
      appendProviderLogo(option, slug, { size: 16, className: 'pivi-provider-add-option-logo' });
    }
    option.createSpan({ text: getDisplayName(prov) });
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      pickerDropdown.removeClass('is-visible');
      void addProvider(prov);
    });
  }

  pickerTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    pickerDropdown.toggleClass('is-visible', !pickerDropdown.hasClass('is-visible'));
  });

  (container.ownerDocument ?? window.document).addEventListener('click', () => {
    pickerDropdown.removeClass('is-visible');
  });

  async function addProvider(providerId: string): Promise<void> {
    if (!providerId || state.piSettings.addedProviders.includes(providerId)) {
      new Notice(t('settings.modelsTab.selectProvider'));
      return;
    }
    const added = [...state.piSettings.addedProviders, providerId];
    state.updatePiSettings({ addedProviders: added });
    await context.plugin.saveSettings();
    context.redisplay();
    new Notice(t('settings.modelsTab.addedProvider', {
      name: getDisplayName(providerId),
    }));
  }
}
