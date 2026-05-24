import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../core/prompt/mainAgent';
import type ObsiusPlugin from '../../main';
import { getVaultPath } from '../../utils/path';

export function buildPiSystemPromptSettings(plugin: ObsiusPlugin): SystemPromptSettings {
  return {
    mediaFolder: plugin.settings.mediaFolder,
    customPrompt: plugin.settings.systemPrompt,
    vaultPath: getVaultPath(plugin.app) ?? undefined,
    userName: plugin.settings.userName,
  };
}

export function buildPiSystemPrompt(plugin: ObsiusPlugin): string {
  return buildSystemPrompt(buildPiSystemPromptSettings(plugin));
}

export function computePiSystemPromptKey(plugin: ObsiusPlugin): string {
  return computeSystemPromptKey(buildPiSystemPromptSettings(plugin));
}
