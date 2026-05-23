import type { AgentSettingsTabRenderer } from '../../core/agent/types';
import { renderPiModelsSettingsSection } from './PiModelsSettingsSection';

export const piSettingsTabRenderer: AgentSettingsTabRenderer = {
  render(container, context) {
    renderPiModelsSettingsSection(container, {
      plugin: context.plugin,
      redisplay: () => context.refreshModelSelectors(),
    });
  },
};
