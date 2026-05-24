import type { AgentSettingsTabRenderer } from '../../core/agent/types';
import { renderPiModelsSettingsSection } from './PiModelsSettingsSection';
import { renderPiSkillsSettingsSection } from './PiSkillsSettingsSection';

export const piSettingsTabRenderer: AgentSettingsTabRenderer = {
  render(container, context) {
    const redisplay = () => context.refreshModelSelectors();
    renderPiModelsSettingsSection(container, {
      plugin: context.plugin,
      redisplay,
    });
    renderPiSkillsSettingsSection(container, {
      plugin: context.plugin,
      redisplay,
    });
  },
};
