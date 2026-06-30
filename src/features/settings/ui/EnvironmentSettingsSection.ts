import { Setting } from 'obsidian';

import { getEnvironmentReviewKeysForScope } from '../../../core/agent/AgentEnvironment';
import type { EnvironmentScope } from '../../../core/types/settings';
import type PiviPlugin from '../../../main';
import { EnvSnippetManager } from './EnvSnippetManager';

interface EnvironmentSettingsSectionOptions {
  container: HTMLElement;
  plugin: PiviPlugin;
  scope: EnvironmentScope;
  heading?: string;
  name: string;
  desc: string;
  placeholder: string;
  renderCustomContextLimits?: (container: HTMLElement) => void;
  onEnvironmentChanged?: () => void;
}

export function renderEnvironmentSettingsSection(
  options: EnvironmentSettingsSectionOptions,
): void {
  const {
    container,
    plugin,
    scope,
    heading,
    name,
    desc,
    placeholder,
    renderCustomContextLimits,
    onEnvironmentChanged,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  let envTextarea: HTMLTextAreaElement | null = null;
  const reviewEl = container.createDiv({
    cls: 'pivi-env-review-warning pivi-setting-validation pivi-setting-validation-warning pivi-hidden',
  });

  const updateReviewWarning = () => {
    const reviewKeys = getEnvironmentReviewKeysForScope(envTextarea?.value ?? '', scope);
    if (reviewKeys.length === 0) {
      reviewEl.toggleClass('pivi-hidden', true);
      reviewEl.empty();
      return;
    }

    reviewEl.setText(`Review environment ownership for: ${reviewKeys.join(', ')}`);
    reviewEl.toggleClass('pivi-hidden', false);
  };

  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addTextArea((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.getEnvironmentVariablesForScope(scope));
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass('pivi-settings-env-textarea');
      text.inputEl.dataset.envScope = scope;
      text.inputEl.addEventListener('input', () => updateReviewWarning());
      text.inputEl.addEventListener('blur', () => {
        void (async (): Promise<void> => {
          await plugin.applyEnvironmentVariables(scope, text.inputEl.value);
          if (contextLimitsContainer) {
            renderCustomContextLimits?.(contextLimitsContainer);
          }
          onEnvironmentChanged?.();
          updateReviewWarning();
        })();
      });
      envTextarea = text.inputEl;
    });

  updateReviewWarning();

  const contextLimitsContainer = renderCustomContextLimits
    ? container.createDiv({ cls: 'pivi-context-limits-container' })
    : null;
  if (contextLimitsContainer) {
    renderCustomContextLimits?.(contextLimitsContainer);
  }

  const envSnippetsContainer = container.createDiv({ cls: 'pivi-env-snippets-container' });
  new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    if (contextLimitsContainer) {
      renderCustomContextLimits?.(contextLimitsContainer);
    }
    onEnvironmentChanged?.();
  });
}
