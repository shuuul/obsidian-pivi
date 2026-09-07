import type { CapabilityApprovalPort } from '@pivi/agent/ports';
import type { ObsidianToolsSettings } from '@pivi/agent/settings';
import { isDisabledToolName, type ToolSpec } from '@pivi/agent/tools';
import {
  ExternalFileApi,
  getVaultPath,
  isOfficialObsidianCliEnabled,
  ObsidianCliTransport,
  ObsidianVaultApi,
  systemProcessRunner,
} from '@pivi/obsidian-host';
import type { App } from 'obsidian';

import { createAttachmentTool } from './obsidian/attachment';
import { createBaseTool } from './obsidian/base';
import { createBashTool } from './obsidian/bash';
import { createBookmarksTool } from './obsidian/bookmarks';
import { createCommandTool } from './obsidian/command';
import { createDailyTool } from './obsidian/daily';
import { createDeletePathTool } from './obsidian/deletePath';
import type { ObsidianToolDeps } from './obsidian/deps';
import { createEditNoteTool } from './obsidian/editNote';
import { createGenerateImageTool } from './obsidian/generateImage';
import { createGraphTool } from './obsidian/graph';
import { createHistoryTool } from './obsidian/history';
import { createLinksTool } from './obsidian/links';
import { createListPathTool } from './obsidian/listPath';
import { createMarkdownStructureTool } from './obsidian/markdownStructure';
import { createMkdirTool } from './obsidian/mkdir';
import { createMovePathTool } from './obsidian/movePath';
import { createNoteInfoTool } from './obsidian/noteInfo';
import { createOpenPathTool } from './obsidian/openPath';
import { createPropertiesTool } from './obsidian/properties';
import { createReadNoteTool } from './obsidian/readNote';
import { createSearchTool } from './obsidian/search';
import { createTagsTool } from './obsidian/tags';
import { createTasksTool } from './obsidian/tasks';
import { createTemplatesTool } from './obsidian/templates';
import { createWriteNoteTool } from './obsidian/writeNote';

function isCorePluginEnabled(app: App, id: string): boolean {
  const internalPlugins = (app as App & {
    internalPlugins?: {
      getPluginById?: (pluginId: string) => { enabled?: boolean } | null;
    };
  }).internalPlugins;
  if (typeof internalPlugins?.getPluginById !== 'function') {
    return true;
  }
  return internalPlugins.getPluginById(id)?.enabled !== false;
}

export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  options: {
    imageGenerator?: ObsidianToolDeps['imageGenerator'];
    externalReadDirectories?: readonly string[];
    obsidianCliAvailable?: boolean;
    resolveReadMaxChars?: ObsidianToolDeps['resolveReadMaxChars'];
    capabilityApproval?: CapabilityApprovalPort | null;
    getBashPermissions?: ObsidianToolDeps['getBashPermissions'];
  } = {},
): ToolSpec[] {
  const disabledTools = settings.disabledTools ?? [];
  const vault = new ObsidianVaultApi(app);
  const vaultPath = getVaultPath(app);
  const cli = new ObsidianCliTransport(settings, {
    processRunner: systemProcessRunner,
    vaultPath,
  });
  const obsidianCliAvailable = options.obsidianCliAvailable ?? (
    settings.cliEnabled && isOfficialObsidianCliEnabled()
  );
  const implicitVaultRoot = vaultPath ? [vaultPath] : [];
  const externalReadDirectories = [
    ...implicitVaultRoot,
    ...(settings.allowExternalRead ? [
      ...(settings.externalReadDirectories ?? []),
      ...(options.externalReadDirectories ?? []),
    ] : []),
  ].filter((directory): directory is string => typeof directory === 'string' && directory.trim().length > 0);
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
    getBashPermissions: options.getBashPermissions,
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
    ...(obsidianCliAvailable
      ? [
        createHistoryTool(deps),
        createTasksTool(deps),
        ...(isCorePluginEnabled(app, 'templates') ? [createTemplatesTool(deps)] : []),
        ...(isCorePluginEnabled(app, 'bookmarks') ? [createBookmarksTool(deps)] : []),
      ]
      : []),
    createDeletePathTool(deps),
    createMovePathTool(deps),
    createListPathTool(deps),
    createMkdirTool(deps),
    createOpenPathTool(deps),
    createAttachmentTool(deps),
    ...(obsidianCliAvailable && isCorePluginEnabled(app, 'daily-notes') ? [createDailyTool(deps)] : []),
    createGraphTool(deps),
    createTagsTool(deps),
    createBaseTool(deps),
  ];

  if (options.imageGenerator) {
    tools.push(createGenerateImageTool(deps));
  }

  if (obsidianCliAvailable) {
    tools.push(createCommandTool(deps));
  }
  if (settings.allowBash) {
    tools.push(createBashTool(deps));
  }
  return tools.filter((tool) => !isDisabledToolName(disabledTools, tool.name));
}
