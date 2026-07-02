import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ObsidianToolsSettings } from '@pivi/core/settings';
import type { PiMcpBridge } from '@pivi/mcp';
import { ObsidianVaultApi } from '@pivi/obsidian-host';
import {
  createResolveApprovalPattern,
  getObsidianToolsSettingsFromBag,
} from '@pivi/obsidian-tools';
import type { SessionApprovalRules } from '@pivi/tools';
import { OBSIDIAN_AGENT_TOOLS } from '@pivi/tools';
import type { App } from 'obsidian';

import { createObsidianAgentTools } from '../createObsidianAgentTools';
import type { PiRuntimeHost } from '../host/runtimeHost';
import { loadContextLayers } from '../loadContextLayers';
import { toPiAgentTool } from '../PiToolAdapter';
import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '../prompt/obsidianAgentTools';
import type { ApprovalCallback } from '../types';
import { createGatedApproval } from './createGatedApproval';
import { createSkillTool } from './createSkillTool';
import { createSubagentTool } from './createSubagentTool';

export interface PiToolRegistry {
  tools: AgentTool[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

export function buildPiToolRegistry(options: {
  host: PiRuntimeHost;
  app: App;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: PiMcpBridge | null;
  approvalCallback: ApprovalCallback | null;
  sessionApprovalRules: SessionApprovalRules;
}): PiToolRegistry {
  const obsidianSettings: ObsidianToolsSettings = getObsidianToolsSettingsFromBag(
    options.host.settings,
  );

  const vaultApi = new ObsidianVaultApi(options.app);
  const resolvePattern = createResolveApprovalPattern(vaultApi, options.vaultPath || null);
  const approve = createGatedApproval(
    options.approvalCallback,
    options.sessionApprovalRules,
    resolvePattern,
  );

  const obsidianTools = createObsidianAgentTools(options.app, obsidianSettings, approve);

  const layers = loadContextLayers(options.vaultPath, options.activeNotePath);
  const skillTool = createSkillTool(layers.skills);
  const subagentTool = createSubagentTool(options.host);

  const mcpTools = options.mcpBridge?.getToolSpecs().map(toPiAgentTool) ?? [];

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