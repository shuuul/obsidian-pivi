import type {
  AgentSettingsTabRenderer,
  AgentSettingsTabRendererContext,
} from '@pivi/obsidian-host/serviceContracts';

import type PiviPlugin from '@/app/PiviPluginHost';

import { renderPiModelsSettingsSection } from "./models-settings";
import { renderPiSkillsSettingsSection } from "./PiSkillsSettingsSection";

function createSectionContext(context: AgentSettingsTabRendererContext) {
  return {
    plugin: context.host.rawHost as PiviPlugin,
    redisplay: () => context.refreshModelSelectors(),
    onEnvironmentChanged: context.onEnvironmentChanged
      ? () => context.onEnvironmentChanged?.()
      : undefined,
  };
}

function renderModels(
  container: HTMLElement,
  context: AgentSettingsTabRendererContext,
): void {
  renderPiModelsSettingsSection(container, createSectionContext(context));
}

function renderSkills(
  container: HTMLElement,
  context: AgentSettingsTabRendererContext,
): void {
  renderPiSkillsSettingsSection(container, createSectionContext(context));
}

export const piSettingsTabRenderer: AgentSettingsTabRenderer = {
  renderModels,
  renderSkills,
};
