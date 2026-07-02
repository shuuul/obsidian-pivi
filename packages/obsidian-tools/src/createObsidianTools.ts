import type { ObsidianToolsSettings } from '@pivi/core';
import { ObsidianCliTransport, ObsidianVaultApi } from '@pivi/obsidian-host';
import type { ToolSpec } from '@pivi/tools';
import type { App } from 'obsidian';

import type { ObsidianApprovalFn } from './obsidian/approval';
import { createAttachmentTool } from './obsidian/attachment';
import { createCommandTool } from './obsidian/command';
import { createDeletePathTool } from './obsidian/deletePath';
import type { ObsidianToolDeps } from './obsidian/deps';
import { createEditNoteTool } from './obsidian/editNote';
import { createEvalTool } from './obsidian/eval';
import { createLinksTool } from './obsidian/links';
import { createListPathTool } from './obsidian/listPath';
import { createMkdirTool } from './obsidian/mkdir';
import { createMovePathTool } from './obsidian/movePath';
import { createNoteInfoTool } from './obsidian/noteInfo';
import { createOpenPathTool } from './obsidian/openPath';
import { createPropertiesTool } from './obsidian/properties';
import { createReadNoteTool } from './obsidian/readNote';
import { createSearchTool } from './obsidian/search';
import { createTasksTool } from './obsidian/tasks';
import { createWriteNoteTool } from './obsidian/writeNote';

export type { ObsidianApprovalFn } from './obsidian/approval';

export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  approve: ObsidianApprovalFn | null,
): ToolSpec[] {
  const vault = new ObsidianVaultApi(app);
  const cli = new ObsidianCliTransport(settings);
  const deps: ObsidianToolDeps = {
    vault,
    cli,
    settings,
    vaultName: vault.getVaultName(),
    approve,
  };

  const tools: ToolSpec[] = [
    createReadNoteTool(deps),
    createEditNoteTool(deps),
    createWriteNoteTool(deps),
    createSearchTool(deps),
    createNoteInfoTool(deps),
    createLinksTool(deps),
    createPropertiesTool(deps),
    createTasksTool(deps),
    createDeletePathTool(deps),
    createMovePathTool(deps),
    createListPathTool(deps),
    createMkdirTool(deps),
    createOpenPathTool(deps),
    createAttachmentTool(deps),
  ];

  if (settings.allowCommand) {
    tools.push(createCommandTool(deps));
  }
  if (settings.allowEval) {
    tools.push(createEvalTool(deps));
  }

  return tools;
}
