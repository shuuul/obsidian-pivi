import type { AgentTool } from '@earendil-works/pi-agent-core';

import { loadContextLayers } from '../../context/loadContextLayers';
import { getSubagentRuntimeSettingsFromBag } from '../../foundation/settings';
import type { PiMcpBridge } from '../../mcp';
import type { CapabilityApprovalPort } from '../../ports/capabilityApproval';
import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '../../prompt';
import type { ExternalContextAvailability } from '../../prompt/types';
import type { ToolSpec } from '../../tools';
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
  externalContexts: ExternalContextAvailability[];
}

export interface PiBaseToolProviderOptions {
  vaultPath: string;
  externalContextPaths?: readonly string[];
  resolveReadMaxChars?: (requestedMaxChars?: number) => number;
  capabilityApproval?: CapabilityApprovalPort | null;
}

export interface PiBaseToolProviderResult {
  toolSpecs: ToolSpec[];
  registeredToolSummary: RegisteredToolSummary;
  externalContexts?: ExternalContextAvailability[];
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
  externalContexts?: ExternalContextAvailability[];
  subagentSettings?: { enabled: boolean; allowBackground: boolean; maxConcurrentSubagents: number };
}): PiToolRegistry {
  const layers = loadContextLayers(options.vaultPath, options.activeNotePath);
  const skillTool = createSkillTool(layers.skills);
  const subagentEnabled = options.subagentSettings?.enabled ?? true;
  const subagentTool = subagentEnabled
    ? createSubagentTool(options.subagentQueryRunner, {
      allowBackground: options.subagentSettings?.allowBackground ?? true,
      maxConcurrentSubagents: options.subagentSettings?.maxConcurrentSubagents ?? 3,
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
      mcpInventory: options.mcpBridge?.getCachedInventory() ?? [],
      includeSkill: true,
      includeSubagent: subagentEnabled,
      maxConcurrentSubagents: options.subagentSettings?.maxConcurrentSubagents ?? 3,
    }),
    contextAppendices,
    externalContexts: options.externalContexts ?? [],
  };
}

export function buildPiToolRegistry(options: {
  host: PiRuntimeHost;
  vaultPath: string;
  activeNotePath?: string | null;
  externalContextPaths?: readonly string[];
  mcpBridge: PiMcpBridge | null;
  baseToolProvider: PiBaseToolProvider | null;
  subagentQueryRunner?: PiSubagentQueryRunner;
  resolveReadMaxChars?: (requestedMaxChars?: number) => number;
  capabilityApproval?: CapabilityApprovalPort | null;
}): PiToolRegistry {
  if (!options.baseToolProvider) {
    throw new Error('Pi tool registry requires a baseToolProvider.');
  }

  const providedBaseTools = options.baseToolProvider({
    vaultPath: options.vaultPath,
    externalContextPaths: options.externalContextPaths,
    resolveReadMaxChars: options.resolveReadMaxChars,
    capabilityApproval: options.capabilityApproval ?? null,
  });
  const subagentSettings = getSubagentRuntimeSettingsFromBag(options.host.settings);

  return buildPiToolRegistryCore({
    subagentQueryRunner: options.subagentQueryRunner ?? createPiAuxQueryRunner(options.host),
    vaultPath: options.vaultPath,
    activeNotePath: options.activeNotePath,
    mcpBridge: options.mcpBridge,
    baseToolSpecs: providedBaseTools.toolSpecs,
    registeredToolSummary: providedBaseTools.registeredToolSummary,
    externalContexts: providedBaseTools.externalContexts,
    subagentSettings,
  });
}
