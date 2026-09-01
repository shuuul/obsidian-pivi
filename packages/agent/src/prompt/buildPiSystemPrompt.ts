import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptBuildOptions,
  type SystemPromptSettings,
} from './mainAgent';
import type { PromptModuleSettings } from './modules';

export interface PiSystemPromptToolRegistry {
  registeredToolNames: string[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

export function buildPiSystemPromptSettings(
  vaultPath: string | undefined,
  userName: string | undefined,
): SystemPromptSettings {
  return { vaultPath, userName };
}

function buildPiSystemPromptOptions(
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
  composition?: PromptModuleSettings,
): SystemPromptBuildOptions {
  return {
    currentDateIso: new Date().toISOString().slice(0, 10),
    registeredToolsSection: toolRegistry?.registeredToolsSection,
    registeredToolNames: toolRegistry?.registeredToolNames,
    appendices: toolRegistry?.contextAppendices,
    promptModules: composition?.promptModules,
    customPromptModules: composition?.customPromptModules,
  };
}

export function buildPiSystemPrompt(
  vaultPath: string | undefined,
  userName: string | undefined,
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
  composition?: PromptModuleSettings,
): string {
  return buildSystemPrompt(
    buildPiSystemPromptSettings(vaultPath, userName),
    buildPiSystemPromptOptions(toolRegistry, composition),
  );
}

export function computePiSystemPromptKey(
  vaultPath: string | undefined,
  userName: string | undefined,
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
  composition?: PromptModuleSettings,
): string {
  return computeSystemPromptKey(
    buildPiSystemPromptSettings(vaultPath, userName),
    buildPiSystemPromptOptions(toolRegistry, composition),
  );
}
