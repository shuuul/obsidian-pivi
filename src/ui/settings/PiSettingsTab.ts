import type { PiviSettingsHost } from "@/app/hostContracts";
import type {
  AgentSettingsTabRenderer,
  AgentSettingsTabRendererContext,
} from "@/app/hostPlatform";

import { renderPiModelsSettingsSection } from "./models-settings";
import { renderPiSkillsSettingsSection } from "./PiSkillsSettingsSection";

function createSectionContext(context: AgentSettingsTabRendererContext) {
  return {
    plugin: context.host.rawHost as PiviSettingsHost,
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
