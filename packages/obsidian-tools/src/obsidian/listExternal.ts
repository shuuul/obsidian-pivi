import {
  textResult,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { CAPABILITY_TOOL_NAMES, ensureExternalDirectoryAccess } from '../capabilityApprovalGate';
import type { ObsidianToolDeps } from './deps';
import { getStringField } from './readShared';

export function createListExternalTool(deps: ObsidianToolDeps): ToolSpec {
  return {
    name: TOOL_OBSIDIAN_LIST_EXTERNAL,
    label: 'List external folder',
    description: 'List direct children of an external folder by absolute path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path to a folder, e.g. /Users/me/Workspace' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const absolutePath = getStringField(input, 'path');
      if (!absolutePath) {
        throw new Error('Invalid list external input: path must be an absolute string.');
      }
      const externalFiles = await ensureExternalDirectoryAccess(
        deps,
        absolutePath,
        true,
        CAPABILITY_TOOL_NAMES.listExternal,
      );
      const result = externalFiles.listPath(absolutePath);
      return textResult(JSON.stringify(result, null, 2), { count: result.length });
    },
  };
}
