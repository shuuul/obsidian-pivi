import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptBuildOptions,
  type SystemPromptSettings,
} from '../../core/prompt/mainAgent';
import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import type { PiToolRegistry } from '../tools/buildAgentToolRegistry';

export function buildPiSystemPromptSettings(plugin: ObsiusPlugin): SystemPromptSettings {
  return {
    mediaFolder: plugin.settings.mediaFolder,
    customPrompt: plugin.settings.systemPrompt,
    vaultPath: getVaultPath(plugin.app) ?? undefined,
    userName: plugin.settings.userName,
  };
}

export function buildPiSystemPrompt(
  plugin: ObsiusPlugin,
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
  plugin: ObsiusPlugin,
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
