import { Setting } from 'obsidian';

import { getPiAiModelsForProvider } from '../PiChatUIConfig';
import type { PiModelsSettingsContext, PiModelsSettingsState } from './types';

export function renderProviderModelChecklist(
  body: HTMLElement,
  context: PiModelsSettingsContext,
  state: PiModelsSettingsState,
  providerId: string,
): void {
  new Setting(body).setName('Candidate models pool').setHeading();
  const modelsGrid = body.createDiv({ cls: 'obsius2-models-checklist-grid' });

  const providerModels = getPiAiModelsForProvider(providerId);
  for (const model of providerModels) {
    const isChecked = state.piSettings.visibleModels.includes(model.value);

    const checkboxWrapper = modelsGrid.createDiv({ cls: 'obsius2-model-checkbox-wrapper' });
    const checkbox = checkboxWrapper.createEl('input', {
      type: 'checkbox',
      cls: 'obsius2-model-checkbox',
      attr: { id: `checkbox-${model.value.replace(/\//g, '-')}` },
    });
    checkbox.checked = isChecked;

    const label = checkboxWrapper.createEl('label', {
      cls: 'obsius2-model-checkbox-label',
      attr: { for: `checkbox-${model.value.replace(/\//g, '-')}` },
    });
    label.createSpan({ cls: 'obsius2-model-checkbox-title', text: model.label });
    label.createSpan({ cls: 'obsius2-model-checkbox-desc', text: model.description });

    checkbox.addEventListener('change', () => {
      void (async () => {
        let visible = [...state.piSettings.visibleModels];
        if (checkbox.checked) {
          if (!visible.includes(model.value)) {
            visible.push(model.value);
          }
        } else {
          visible = visible.filter((v) => v !== model.value);
        }

        state.updatePiSettings({ visibleModels: visible });
        await context.plugin.saveSettings();

        for (const view of context.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      })();
    });
  }

  if (providerModels.length === 0) {
    modelsGrid.createDiv({
      cls: 'obsius2-no-models-message',
      text: 'No predefined models loaded for this provider yet.',
    });
  }
}
