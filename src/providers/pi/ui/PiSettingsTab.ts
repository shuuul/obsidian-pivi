import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderPiProvidersSettingsSection } from './PiProvidersSettingsSection';

export const piSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    renderPiProvidersSettingsSection(container, {
      plugin: context.plugin,
      redisplay: () => context.refreshModelSelectors(),
    });
  },
};
