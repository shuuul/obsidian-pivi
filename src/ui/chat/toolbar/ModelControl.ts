import { appendModelOptionIcon } from '@/ui/shared/utils/providerLogoDom';

import { runToolbarAction, type ToolbarCallbacks } from './ToolbarTypes';

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-model-selector' });
    this.render();
  }

  private getAvailableModels() {
    const settings = this.callbacks.getSettings();
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'pivi-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-model-dropdown' });
    this.renderOptions();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];
    const uiConfig = this.callbacks.getUIConfig();

    this.buttonEl.empty();

    if (displayModel) {
      appendModelOptionIcon(this.buttonEl, displayModel, {
        fallbackChatIcon: uiConfig.getChatIcon?.() ?? undefined,
        size: 12,
      });
    }

    const labelEl = this.buttonEl.createSpan({ cls: 'pivi-model-label' });
    labelEl.setText(displayModel?.label || 'Unknown');
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const uiConfig = this.callbacks.getUIConfig();
    const fallbackChatIcon = uiConfig.getChatIcon?.() ?? undefined;

    const reversed = [...models].reverse();

    let lastGroup: string | undefined;
    for (const model of reversed) {
      if (model.group && model.group !== lastGroup) {
        const separator = this.dropdownEl.createDiv({ cls: 'pivi-model-group' });
        separator.setText(model.group);
        lastGroup = model.group;
      }

      const option = this.dropdownEl.createDiv({ cls: 'pivi-model-option' });
      if (model.value === currentModel) {
        option.addClass('selected');
      }

      appendModelOptionIcon(option, model, {
        fallbackChatIcon,
        size: 12,
      });
      option.createSpan({ cls: 'pivi-model-option-label', text: model.label });

      if (model.description) {
        option.setAttribute('title', model.description);
      }

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderOptions();
        }, 'Failed to change model');
      });
    }
  }
}
