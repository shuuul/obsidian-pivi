import { getVaultPath } from '@pivi/obsidian-host/path';

import type { PiRuntimeHost } from './host/runtimeHost';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptBuildOptions,
  type SystemPromptSettings,
} from './prompt/mainAgent';
import type { PiToolRegistry } from './tools/buildPiToolRegistry';

export function buildPiSystemPromptSettings(plugin: PiRuntimeHost): SystemPromptSettings {
  return {
    vaultPath: getVaultPath(plugin.app) ?? undefined,
    userName: plugin.settings.userName,
  };
}

export function buildPiSystemPrompt(
  plugin: PiRuntimeHost,
  toolRegistry?: Pick<PiToolRegistry, 'registeredToolsSection' | 'contextAppendices'>,
): string {
  const options: SystemPromptBuildOptions = {
    currentDateIso: new Date().toISOString().slice(0, 10),
    registeredToolsSection: toolRegistry?.registeredToolsSection,
    appendices: toolRegistry?.contextAppendices,
  };
  return buildSystemPrompt(buildPiSystemPromptSettings(plugin), options);
}

export function computePiSystemPromptKey(
  plugin: PiRuntimeHost,
  toolRegistry?: Pick<PiToolRegistry, 'registeredToolsSection' | 'contextAppendices'>,
): string {
  const settings = buildPiSystemPromptSettings(plugin);
  const options: SystemPromptBuildOptions = {
    currentDateIso: new Date().toISOString().slice(0, 10),
    registeredToolsSection: toolRegistry?.registeredToolsSection,
    appendices: toolRegistry?.contextAppendices,
  };
  return computeSystemPromptKey(settings, options);
}
