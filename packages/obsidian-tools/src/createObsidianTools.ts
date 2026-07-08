import { ExternalFileApi, ObsidianCliTransport, ObsidianVaultApi, systemProcessRunner } from '@pivi/obsidian-host';
import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { ToolSpec } from '@pivi/pivi-agent-core/tools';
import type { App } from 'obsidian';

import { createAttachmentTool } from './obsidian/attachment';
import { createBashTool } from './obsidian/bash';
import { createCommandTool } from './obsidian/command';
import { createDeletePathTool } from './obsidian/deletePath';
import type { ObsidianToolDeps } from './obsidian/deps';
import { createEditNoteTool } from './obsidian/editNote';
import { createEvalTool } from './obsidian/eval';
import { createGenerateImageTool } from './obsidian/generateImage';
import { createHistoryTool } from './obsidian/history';
import { createLinksTool } from './obsidian/links';
import { createListExternalTool } from './obsidian/listExternal';
import { createListPathTool } from './obsidian/listPath';
import { createMarkdownStructureTool } from './obsidian/markdownStructure';
import { createMkdirTool } from './obsidian/mkdir';
import { createMovePathTool } from './obsidian/movePath';
import { createNoteInfoTool } from './obsidian/noteInfo';
import { createOpenPathTool } from './obsidian/openPath';
import { createPropertiesTool } from './obsidian/properties';
import { createReadExternalTool } from './obsidian/readExternal';
import { createReadNoteTool } from './obsidian/readNote';
import { createSearchTool } from './obsidian/search';
import { createTasksTool } from './obsidian/tasks';
import { createWriteNoteTool } from './obsidian/writeNote';


export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  options: {
    imageGenerator?: ObsidianToolDeps['imageGenerator'];
    externalReadDirectories?: readonly string[];
  } = {},
): ToolSpec[] {
  const disabledTools = new Set(settings.disabledTools ?? []);
  const vault = new ObsidianVaultApi(app);
  const cli = new ObsidianCliTransport(settings);
  const externalReadDirectories = settings.allowExternalRead
    ? [
      ...(settings.externalReadDirectories ?? []),
      ...(options.externalReadDirectories ?? []),
    ].filter((directory): directory is string => typeof directory === 'string' && directory.trim().length > 0)
    : [];
  const externalFiles = new ExternalFileApi(externalReadDirectories);
  const deps: ObsidianToolDeps = {
    vault,
    cli,
    externalFiles,
    settings,
    vaultName: vault.getVaultName(),
    processRunner: systemProcessRunner,
    imageGenerator: options.imageGenerator,
  };

  const tools: ToolSpec[] = [
    createReadNoteTool(deps),
    createMarkdownStructureTool(deps),
    createEditNoteTool(deps),
    createWriteNoteTool(deps),
    createSearchTool(deps),
    createNoteInfoTool(deps),
    createLinksTool(deps),
    createPropertiesTool(deps),
    createHistoryTool(deps),
    createTasksTool(deps),
    createDeletePathTool(deps),
    createMovePathTool(deps),
    createListPathTool(deps),
    createMkdirTool(deps),
    createOpenPathTool(deps),
    createAttachmentTool(deps),
  ];

  if (options.imageGenerator) {
    tools.push(createGenerateImageTool(deps));
  }

  if (settings.allowExternalRead && externalReadDirectories.length > 0) {
    tools.push(createReadExternalTool(deps));
    tools.push(createListExternalTool(deps));
  }

  if (settings.allowCommand) {
    tools.push(createCommandTool(deps));
  }
  if (settings.allowBash) {
    tools.push(createBashTool(deps));
  }
  if (settings.allowEval) {
    tools.push(createEvalTool(deps));
  }

  return tools.filter((tool) => !disabledTools.has(tool.name));
}
