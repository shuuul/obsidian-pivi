import type { AgentTool } from '@earendil-works/pi-agent-core';
import { loadContextLayers } from '@pivi/agent/context/loadContextLayers';
import type { McpToolBridge } from '@pivi/agent/mcp';
import type { CapabilityApprovalPort } from '@pivi/agent/ports/capabilityApproval';
import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '@pivi/agent/prompt';
import type { ExternalContextAvailability } from '@pivi/agent/prompt/types';
import type { ReadAllowanceReservation } from '@pivi/agent/runtime/usage';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/agent/settings/types';
import type { ToolSpec } from '@pivi/agent/tools';

import { createPiAuxQueryRunner } from '../runtime/piAuxQueryRunner';
import type { PiRuntimeHost } from '../runtime/piRuntimeHost';
import { createSkillTool } from './createSkillTool';
import {
  createSubagentTool,
  type PiSubagentQueryRunner,
} from './createSubagentTool';
import { toPiAgentTool } from './piToolAdapter';

export interface PiToolRegistry {
  tools: AgentTool[];
  registeredToolNames: string[];
  registeredToolsSection: string;
  contextAppendices: string[];
  externalContexts: ExternalContextAvailability[];
}

export interface PiBaseToolProviderOptions {
  vaultPath: string;
  externalContextPaths?: readonly string[];
  resolveReadMaxChars?: (requestedMaxChars?: number) => ReadAllowanceReservation;
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

/**
 * Main-Agent-only tool provider. Distinct from {@link PiBaseToolProvider}:
 * main registry composition may call it; subagent inventory construction must
 * never request, receive, or filter it (structural absence, not a name blacklist).
 */
export type PiMainOnlyToolProvider = (
  options: PiBaseToolProviderOptions,
) => PiBaseToolProviderResult;

export function buildPiToolRegistryCore(options: {
  subagentQueryRunner: PiSubagentQueryRunner;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: McpToolBridge | null;
  baseToolSpecs: ToolSpec[];
  /** Main-Agent-only ToolSpecs; omitted from subagent inventory by not being passed. */
  mainOnlyToolSpecs?: ToolSpec[];
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
  const mainOnlyToolSpecs = options.mainOnlyToolSpecs ?? [];
  const mainOnlyTools = mainOnlyToolSpecs.map(toPiAgentTool);

  const tools: AgentTool[] = [
    ...baseTools,
    ...mainOnlyTools,
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

  const mainOnlyToolNames = mainOnlyToolSpecs.map((spec) => spec.name);
  const registeredToolSummary: RegisteredToolSummary = mainOnlyToolNames.length > 0
    ? {
      ...options.registeredToolSummary,
      obsidianTools: [
        ...options.registeredToolSummary.obsidianTools,
        ...mainOnlyToolNames,
      ],
    }
    : options.registeredToolSummary;
  const registeredSpecs = [...options.baseToolSpecs, ...mainOnlyToolSpecs];

  return {
    tools,
    registeredToolNames: tools.map((tool) => tool.name),
    registeredToolsSection: buildRegisteredToolsSection({
      ...registeredToolSummary,
      toolSpecs: registeredSpecs,
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
  mcpBridge: McpToolBridge | null;
  baseToolProvider: PiBaseToolProvider | null;
  /** Optional; main Agent only. Never passed into subagent tool construction. */
  mainOnlyToolProvider?: PiMainOnlyToolProvider | null;
  subagentQueryRunner?: PiSubagentQueryRunner;
  resolveReadMaxChars?: (requestedMaxChars?: number) => ReadAllowanceReservation;
  capabilityApproval?: CapabilityApprovalPort | null;
}): PiToolRegistry {
  if (!options.baseToolProvider) {
    throw new Error('Pi tool registry requires a baseToolProvider.');
  }

  const providerOptions: PiBaseToolProviderOptions = {
    vaultPath: options.vaultPath,
    externalContextPaths: options.externalContextPaths,
    resolveReadMaxChars: options.resolveReadMaxChars,
    capabilityApproval: options.capabilityApproval ?? null,
  };
  const providedBaseTools = options.baseToolProvider(providerOptions);
  const mainOnlyToolSpecs = options.mainOnlyToolProvider
    ? options.mainOnlyToolProvider(providerOptions).toolSpecs
    : undefined;
  const subagentSettings = getSubagentRuntimeSettingsFromBag(options.host.settings);

  return buildPiToolRegistryCore({
    subagentQueryRunner: options.subagentQueryRunner ?? createPiAuxQueryRunner(options.host),
    vaultPath: options.vaultPath,
    activeNotePath: options.activeNotePath,
    mcpBridge: options.mcpBridge,
    baseToolSpecs: providedBaseTools.toolSpecs,
    mainOnlyToolSpecs,
    registeredToolSummary: providedBaseTools.registeredToolSummary,
    externalContexts: providedBaseTools.externalContexts,
    subagentSettings,
  });
}
