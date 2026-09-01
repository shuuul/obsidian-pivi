import {
  composePromptSections,
  computePromptCompositionKey,
  type CustomPromptModule,
  type PromptModuleOverride,
} from './modules';

export interface SystemPromptSettings {
  vaultPath?: string;
  userName?: string;
}

export interface SystemPromptBuildOptions {
  appendices?: string[];
  /** ISO date string injected into the prompt (Pivi runtime). */
  currentDateIso?: string;
  /** Describes tools actually registered on the agent. */
  registeredToolsSection?: string;
  /** Actual executable tool identities. When supplied, tool-specific base guidance is capability-filtered. */
  registeredToolNames?: readonly string[];
  promptModules?: Readonly<Record<string, PromptModuleOverride>>;
  customPromptModules?: readonly CustomPromptModule[];
}

function getAppendixSections(appendices?: string[]): string {
  if (!appendices || appendices.length === 0) {
    return '';
  }

  const sections = appendices
    .map((appendix) => appendix.trim())
    .filter(Boolean);

  if (sections.length === 0) {
    return '';
  }

  return `\n\n${sections.join('\n\n')}`;
}

export function buildSystemPrompt(
  settings: SystemPromptSettings = {},
  options: SystemPromptBuildOptions = {},
): string {
  const composed = composePromptSections({
    overrides: options.promptModules,
    custom: options.customPromptModules,
    userName: settings.userName,
    registeredToolNames: options.registeredToolNames,
  });
  let prompt = composed.fullStatic;

  if (options.currentDateIso) {
    prompt += `\n\n**Current date (runtime):** ${options.currentDateIso}`;
  }

  if (options.registeredToolsSection?.trim()) {
    prompt += `\n\n${options.registeredToolsSection.trim()}`;
  }

  prompt += getAppendixSections(options.appendices);

  return prompt;
}

export function computeSystemPromptKey(
  settings: SystemPromptSettings,
  options: SystemPromptBuildOptions = {},
): string {
  const appendixKey = (options.appendices || [])
    .map((appendix) => appendix.trim())
    .filter(Boolean)
    .join('||');

  const parts = [
    settings.vaultPath || '',
    (settings.userName || '').trim(),
    options.registeredToolsSection || '',
    options.currentDateIso || '',
  ];

  if (options.registeredToolNames) {
    parts.push(options.registeredToolNames.join(','));
  }

  if (appendixKey) {
    parts.push(appendixKey);
  }

  const compositionKey = computePromptCompositionKey(
    options.promptModules,
    options.customPromptModules,
  );
  if (compositionKey !== undefined) {
    parts.push(compositionKey);
  }

  return parts.join('::');
}
