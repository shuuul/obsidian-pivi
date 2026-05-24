import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { App } from 'obsidian';

import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '../../core/prompt/obsidianAgentTools';
import type { ApprovalCallback } from '../../core/runtime/types';
import { OBSIDIAN_AGENT_TOOLS } from '../../core/tools/obsidianToolNames';
import type { ObsidianToolsSettings } from '../../core/types/settings';
import type ObsiusPlugin from '../../main';
import { loadContextLayers } from '../context/loadContextLayers';
import type { PiMcpBridge } from '../mcp/PiMcpBridge';
import { createObsidianTools, type ObsidianApprovalFn } from './createObsidianTools';
import { createSkillTool } from './createSkillTool';
import { createSubagentTool } from './createSubagentTool';
import { getObsidianToolsSettingsFromBag } from './settings';

export interface PiToolRegistry {
  tools: AgentTool[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

function toObsidianApproval(fn: ApprovalCallback | null): ObsidianApprovalFn | null {
  if (!fn) {
    return null;
  }
  return async (toolName, input, description) => fn(toolName, input, description);
}

export function buildPiToolRegistry(options: {
  plugin: ObsiusPlugin;
  app: App;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: PiMcpBridge | null;
  approvalCallback: ApprovalCallback | null;
}): PiToolRegistry {
  const obsidianSettings: ObsidianToolsSettings = getObsidianToolsSettingsFromBag(
    options.plugin.settings as unknown as Record<string, unknown>,
  );

  const obsidianTools = createObsidianTools(
    options.app,
    obsidianSettings,
    toObsidianApproval(options.approvalCallback),
  );

  const layers = loadContextLayers(options.vaultPath, options.activeNotePath);
  const skillTool = createSkillTool(layers.skills);
  const subagentTool = createSubagentTool(options.plugin);

  const mcpTools = options.mcpBridge?.getAgentTools() ?? [];

  const tools: AgentTool[] = [...obsidianTools, skillTool, subagentTool, ...mcpTools];

  const summary: RegisteredToolSummary = {
    obsidianTools: OBSIDIAN_AGENT_TOOLS,
    includeMcp: mcpTools.length > 0,
    includeSkill: true,
    includeSubagent: true,
    allowCommand: obsidianSettings.allowCommand,
    allowEval: obsidianSettings.allowEval,
  };

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
    registeredToolsSection: buildRegisteredToolsSection(summary),
    contextAppendices,
  };
}
