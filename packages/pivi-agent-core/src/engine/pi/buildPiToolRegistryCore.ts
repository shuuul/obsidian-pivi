import type { AgentTool } from '@earendil-works/pi-agent-core';
import { loadContextLayers } from '@pivi/pivi-agent-core/context/loadContextLayers';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import type { PiMcpBridge } from '@pivi/pivi-agent-core/mcp';
import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '@pivi/pivi-agent-core/prompt';
import type { ToolSpec } from '@pivi/pivi-agent-core/tools';

import { createSkillTool } from './createSkillTool';
import {
  createSubagentTool,
  type PiSubagentQueryRunner,
} from './createSubagentTool';
import { createPiAuxQueryRunner } from './piAuxQueryRunner';
import type { PiRuntimeHost } from './piRuntimeHost';
import { toPiAgentTool } from './piToolAdapter';

export interface PiToolRegistry {
  tools: AgentTool[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

export interface PiBaseToolProviderOptions {
  vaultPath: string;
}

export interface PiBaseToolProviderResult {
  toolSpecs: ToolSpec[];
  registeredToolSummary: RegisteredToolSummary;
}

export type PiBaseToolProvider = (
  options: PiBaseToolProviderOptions,
) => PiBaseToolProviderResult;

export function buildPiToolRegistryCore(options: {
  subagentQueryRunner: PiSubagentQueryRunner;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: PiMcpBridge | null;
  baseToolSpecs: ToolSpec[];
  registeredToolSummary: RegisteredToolSummary;
  subagentSettings?: { enabled: boolean; allowBackground: boolean };
}): PiToolRegistry {
  const layers = loadContextLayers(options.vaultPath, options.activeNotePath);
  const skillTool = createSkillTool(layers.skills);
  const subagentEnabled = options.subagentSettings?.enabled ?? true;
  const subagentTool = subagentEnabled
    ? createSubagentTool(options.subagentQueryRunner, {
      allowBackground: options.subagentSettings?.allowBackground ?? true,
    })
    : null;
  const mcpTools = options.mcpBridge?.getToolSpecs().map(toPiAgentTool) ?? [];
  const baseTools = options.baseToolSpecs.map(toPiAgentTool);

  const tools: AgentTool[] = [
    ...baseTools,
    skillTool,
    ...(subagentTool ? [subagentTool] : []),
    ...mcpTools,
  ];

  const contextAppendices: string[] = [];
  if (layers.agentsMd) {
    contextAppendices.push(`## Project instructions (AGENTS.md)\n\n${layers.agentsMd}`);
  }
  if (layers.systemMd) {
    contextAppendices.push(`## Vault system\n\n${layers.systemMd}`);
  }
  if (layers.skillsXml) {
    contextAppendices.push(layers.skillsXml.trim());
  }

  return {
    tools,
    registeredToolsSection: buildRegisteredToolsSection({
      ...options.registeredToolSummary,
      includeMcp: mcpTools.length > 0,
      includeSkill: true,
      includeSubagent: subagentEnabled,
    }),
    contextAppendices,
  };
}

export function buildPiToolRegistry(options: {
  host: PiRuntimeHost;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: PiMcpBridge | null;
  baseToolProvider: PiBaseToolProvider | null;
  subagentQueryRunner?: PiSubagentQueryRunner;
}): PiToolRegistry {
  if (!options.baseToolProvider) {
    throw new Error('Pi tool registry requires a baseToolProvider.');
  }

  const providedBaseTools = options.baseToolProvider({
    vaultPath: options.vaultPath,
  });
  const subagentSettings = getSubagentRuntimeSettingsFromBag(options.host.settings);

  return buildPiToolRegistryCore({
    subagentQueryRunner: options.subagentQueryRunner ?? createPiAuxQueryRunner(options.host),
    vaultPath: options.vaultPath,
    activeNotePath: options.activeNotePath,
    mcpBridge: options.mcpBridge,
    baseToolSpecs: providedBaseTools.toolSpecs,
    registeredToolSummary: providedBaseTools.registeredToolSummary,
    subagentSettings,
  });
}
