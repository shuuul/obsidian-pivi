import { Notice } from 'obsidian';

import { appendProviderLogo } from '../../../shared/providerLogo';
import { getProviderLogoSlug } from '../providerLogos';
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

  const addControls = container.createDiv({ cls: 'obsius2-provider-add-controls' });
  const pickerContainer = addControls.createDiv({ cls: 'obsius2-provider-add-container' });

  const pickerTrigger = pickerContainer.createEl('button', {
    cls: 'obsius2-provider-add-trigger',
    type: 'button',
    text: '+ add provider',
  });

  const pickerDropdown = pickerContainer.createDiv({ cls: 'obsius2-provider-add-dropdown' });

  for (const prov of providersNotAdded) {
    const option = pickerDropdown.createDiv({ cls: 'obsius2-provider-add-option' });
    const slug = getProviderLogoSlug(prov);
    if (slug) {
      appendProviderLogo(option, slug, { size: 16, className: 'obsius2-provider-add-option-logo' });
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
      new Notice('Please select a provider to add.');
      return;
    }
    const added = [...state.piSettings.addedProviders, providerId];
    state.updatePiSettings({ addedProviders: added });
    await context.plugin.saveSettings();
    context.redisplay();
    new Notice(`Added ${getDisplayName(providerId)} provider.`);
  }
}
