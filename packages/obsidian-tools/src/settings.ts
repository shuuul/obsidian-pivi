import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';

export const DEFAULT_OBSIDIAN_TOOLS_SETTINGS: Readonly<ObsidianToolsSettings> = Object.freeze({
  cliEnabled: true,
  cliPath: null,
  cliTimeoutMs: 30_000,
  allowCommand: false,
  commandAllowlist: [],
  allowEval: false,
});

export function resolveObsidianToolsSettings(
  raw: ObsidianToolsSettings | undefined,
): ObsidianToolsSettings {
  if (!raw) {
    return { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS };
  }
  return {
    cliEnabled: raw.cliEnabled ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliEnabled,
    cliPath: raw.cliPath ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliPath,
    cliTimeoutMs: raw.cliTimeoutMs ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliTimeoutMs,
    allowCommand: raw.allowCommand ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowCommand,
    commandAllowlist: Array.isArray(raw.commandAllowlist)
      ? [...raw.commandAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.commandAllowlist],
    allowEval: raw.allowEval ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowEval,
  };
}

export function getObsidianToolsSettingsFromBag(
  settings: Record<string, unknown>,
): ObsidianToolsSettings {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS };
  }
  const obsidianTools = (agentSettings as { obsidianTools?: ObsidianToolsSettings }).obsidianTools;
  return resolveObsidianToolsSettings(obsidianTools);
}
