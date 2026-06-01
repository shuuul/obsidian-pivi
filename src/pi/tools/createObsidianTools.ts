import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { App } from 'obsidian';

import type { ObsidianToolsSettings } from '../../core/types/settings';
import type { ObsidianApprovalFn } from './obsidian/approval';
import { createCommandTool } from './obsidian/command';
import type { ObsidianToolDeps } from './obsidian/deps';
import { createEvalTool } from './obsidian/eval';
import { createLinksTool } from './obsidian/links';
import { createNoteInfoTool } from './obsidian/noteInfo';
import { createPropertiesTool } from './obsidian/properties';
import { createEditNoteTool } from './obsidian/editNote';
import { createReadNoteTool } from './obsidian/readNote';
import { createSearchTool } from './obsidian/search';
import { createTasksTool } from './obsidian/tasks';
import { createWriteNoteTool } from './obsidian/writeNote';
import { ObsidianCliTransport } from './ObsidianCliTransport';
import { ObsidianVaultApi } from './ObsidianVaultApi';

export type { ObsidianApprovalFn } from './obsidian/approval';

export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  approve: ObsidianApprovalFn | null,
): AgentTool[] {
  const vault = new ObsidianVaultApi(app);
  const cli = new ObsidianCliTransport(settings);
  const deps: ObsidianToolDeps = {
    vault,
    cli,
    settings,
    vaultName: vault.getVaultName(),
    approve,
  };

  const tools: AgentTool[] = [
    createReadNoteTool(deps),
    createEditNoteTool(deps),
    createWriteNoteTool(deps),
    createSearchTool(deps),
    createNoteInfoTool(deps),
    createLinksTool(deps),
    createPropertiesTool(deps),
    createTasksTool(deps),
  ];

  if (settings.allowCommand) {
    tools.push(createCommandTool(deps));
  }
  if (settings.allowEval) {
    tools.push(createEvalTool(deps));
  }

  return tools;
}
