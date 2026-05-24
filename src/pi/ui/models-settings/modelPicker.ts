import { Notice, Setting } from 'obsidian';

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
  let selectedProviderToAdd = '';

  const addProviderSetting = new Setting(container)
    .setName('Add AI provider')
    .setDesc('Select an LLM provider supported by Pi to configure and add its models.');

  const addControls = addProviderSetting.controlEl.createDiv({ cls: 'obsius2-provider-add-controls' });
  const pickerContainer = addControls.createDiv({ cls: 'obsius2-provider-add-container' });

  const pickerTrigger = pickerContainer.createEl('button', {
    cls: 'obsius2-provider-add-trigger',
    type: 'button',
  });
  const pickerTriggerLabel = pickerTrigger.createSpan({ cls: 'obsius2-provider-add-trigger-label' });
  pickerTriggerLabel.setText('Select provider...');

  const pickerDropdown = pickerContainer.createDiv({ cls: 'obsius2-provider-add-dropdown' });

  const renderPickerLabel = (providerId: string) => {
    pickerTrigger.empty();
    if (!providerId) {
      pickerTrigger.createSpan({ cls: 'obsius2-provider-add-trigger-label', text: 'Select provider...' });
      return;
    }
    const slug = getProviderLogoSlug(providerId);
    if (slug) {
      appendProviderLogo(pickerTrigger, slug, { size: 16, className: 'obsius2-provider-add-option-logo' });
    }
    pickerTrigger.createSpan({
      cls: 'obsius2-provider-add-trigger-label',
      text: getDisplayName(providerId),
    });
  };

  for (const prov of providersNotAdded) {
    const option = pickerDropdown.createDiv({ cls: 'obsius2-provider-add-option' });
    const slug = getProviderLogoSlug(prov);
    if (slug) {
      appendProviderLogo(option, slug, { size: 16, className: 'obsius2-provider-add-option-logo' });
    }
    option.createSpan({ text: getDisplayName(prov) });
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedProviderToAdd = prov;
      renderPickerLabel(prov);
      pickerDropdown.removeClass('is-visible');
    });
  }

  if (providersNotAdded.length === 0) {
    pickerTrigger.disabled = true;
    pickerTriggerLabel.setText('All providers added');
  }

  pickerTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (providersNotAdded.length === 0) {
      return;
    }
    pickerDropdown.toggleClass('is-visible', !pickerDropdown.hasClass('is-visible'));
  });

  (container.ownerDocument ?? window.document).addEventListener('click', () => {
    pickerDropdown.removeClass('is-visible');
  });

  addControls.createEl('button', { cls: 'mod-cta', text: '+ add', type: 'button' }).addEventListener('click', async () => {
    if (!selectedProviderToAdd) {
      new Notice('Please select a provider to add.');
      return;
    }
    const added = [...state.piSettings.addedProviders, selectedProviderToAdd];
    state.updatePiSettings({ addedProviders: added });
    await context.plugin.saveSettings();
    context.redisplay();
    new Notice(`Added ${getDisplayName(selectedProviderToAdd)} provider.`);
  });
}
