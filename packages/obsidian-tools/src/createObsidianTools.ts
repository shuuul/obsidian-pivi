import {
  ExternalFileApi,
  getVaultPath,
  isOfficialObsidianCliEnabled,
  ObsidianCliTransport,
  ObsidianVaultApi,
  systemProcessRunner,
} from '@pivi/obsidian-host';
import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { CapabilityApprovalPort } from '@pivi/pivi-agent-core/ports';
import type { ToolSpec } from '@pivi/pivi-agent-core/tools';
import type { App } from 'obsidian';

import { createAttachmentTool } from './obsidian/attachment';
import { createBaseTool } from './obsidian/base';
import { createBashTool } from './obsidian/bash';
import { createCommandTool } from './obsidian/command';
import { createDailyTool } from './obsidian/daily';
import { createDeletePathTool } from './obsidian/deletePath';
import type { ObsidianToolDeps } from './obsidian/deps';
import { createEditNoteTool } from './obsidian/editNote';
import { createEvalTool } from './obsidian/eval';
import { createGenerateImageTool } from './obsidian/generateImage';
import { createGraphTool } from './obsidian/graph';
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
import { createTagsTool } from './obsidian/tags';
import { createTasksTool } from './obsidian/tasks';
import { createWriteNoteTool } from './obsidian/writeNote';


export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  options: {
    imageGenerator?: ObsidianToolDeps['imageGenerator'];
    externalReadDirectories?: readonly string[];
    obsidianCliAvailable?: boolean;
    resolveReadMaxChars?: ObsidianToolDeps['resolveReadMaxChars'];
    capabilityApproval?: CapabilityApprovalPort | null;
  } = {},
): ToolSpec[] {
  const disabledTools = new Set(settings.disabledTools ?? []);
  const vault = new ObsidianVaultApi(app);
  const vaultPath = getVaultPath(app);
  const cli = new ObsidianCliTransport(settings, {
    processRunner: systemProcessRunner,
    vaultPath,
  });
  const obsidianCliAvailable = options.obsidianCliAvailable ?? (
    settings.cliEnabled && isOfficialObsidianCliEnabled()
  );
  const externalReadDirectories = settings.allowExternalRead
    ? [
      ...(settings.externalReadDirectories ?? []),
      ...(options.externalReadDirectories ?? []),
    ].filter((directory): directory is string => typeof directory === 'string' && directory.trim().length > 0)
    : [];
  const externalFiles = new ExternalFileApi(externalReadDirectories);
  const deps: ObsidianToolDeps = {
    app,
    vault,
    cli,
    externalFiles,
    settings,
    vaultName: vault.getVaultName(),
    vaultPath,
    obsidianCliAvailable,
    processRunner: systemProcessRunner,
    imageGenerator: options.imageGenerator,
    resolveReadMaxChars: options.resolveReadMaxChars,
    capabilityApproval: options.capabilityApproval ?? null,
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
    ...(obsidianCliAvailable ? [createHistoryTool(deps), createTasksTool(deps)] : []),
    createDeletePathTool(deps),
    createMovePathTool(deps),
    createListPathTool(deps),
    createMkdirTool(deps),
    createOpenPathTool(deps),
    createAttachmentTool(deps),
    ...(obsidianCliAvailable ? [createDailyTool(deps)] : []),
    createGraphTool(deps),
    createTagsTool(deps),
    createBaseTool(deps),
  ];

  if (options.imageGenerator) {
    tools.push(createGenerateImageTool(deps));
  }

  if (settings.allowExternalRead) {
    tools.push(createReadExternalTool(deps));
    tools.push(createListExternalTool(deps));
  }

  if (settings.allowCommand && obsidianCliAvailable) {
    tools.push(createCommandTool(deps));
  }
  if (settings.allowBash) {
    tools.push(createBashTool(deps));
  }
  if (settings.allowEval && obsidianCliAvailable) {
    tools.push(createEvalTool(deps));
  }

  return tools.filter((tool) => !disabledTools.has(tool.name));
}
