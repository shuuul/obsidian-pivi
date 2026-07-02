import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ObsidianToolsSettings } from '@pivi/core';
import createObsidianToolSpecs, { type ObsidianApprovalFn } from '@pivi/obsidian-tools';
import type { App } from 'obsidian';

import { toPiAgentTool } from './PiToolAdapter';

export type { ObsidianApprovalFn };

export function createObsidianAgentTools(
  app: App,
  settings: ObsidianToolsSettings,
  approve: ObsidianApprovalFn | null,
): AgentTool[] {
  return createObsidianToolSpecs(app, settings, approve).map(toPiAgentTool);
}
