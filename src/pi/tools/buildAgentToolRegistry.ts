import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { App } from 'obsidian';

import {
  buildRegisteredToolsSection,
  type RegisteredToolSummary,
} from '../../core/prompt/obsidianAgentTools';
import type { ApprovalCallback } from '../../core/runtime/types';
import type { SessionApprovalRules } from '../../core/security/SessionApprovalRules';
import { OBSIDIAN_AGENT_TOOLS } from '../../core/tools/obsidianToolNames';
import type { ObsidianToolsSettings } from '../../core/types/settings';
import type PiviPlugin from '../../main';
import { loadContextLayers } from '../context/loadContextLayers';
import type { PiMcpBridge } from '../mcp/PiMcpBridge';
import { createGatedApproval } from './createGatedApproval';
import { createObsidianTools } from './createObsidianTools';
import { createSkillTool } from './createSkillTool';
import { createSubagentTool } from './createSubagentTool';
import { createResolveApprovalPattern } from './obsidian/resolveApprovalPattern';
import { ObsidianVaultApi } from './ObsidianVaultApi';
import { getObsidianToolsSettingsFromBag } from './settings';

export interface PiToolRegistry {
  tools: AgentTool[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

export function buildPiToolRegistry(options: {
  plugin: PiviPlugin;
  app: App;
  vaultPath: string;
  activeNotePath?: string | null;
  mcpBridge: PiMcpBridge | null;
  approvalCallback: ApprovalCallback | null;
  sessionApprovalRules: SessionApprovalRules;
}): PiToolRegistry {
  const obsidianSettings: ObsidianToolsSettings = getObsidianToolsSettingsFromBag(
    options.plugin.settings,
  );

  const vaultApi = new ObsidianVaultApi(options.app);
  const resolvePattern = createResolveApprovalPattern(vaultApi, options.vaultPath || null);
  const approve = createGatedApproval(
    options.approvalCallback,
    options.sessionApprovalRules,
    resolvePattern,
  );

  const obsidianTools = createObsidianTools(
    options.app,
    obsidianSettings,
    approve,
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
