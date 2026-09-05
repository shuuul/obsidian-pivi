import {
  textResult,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  type ToolSpec,
} from '@pivi/agent/tools';

import { CAPABILITY_TOOL_NAMES, ensureExternalDirectoryAccess } from '../capabilityApprovalGate';
import type { ObsidianToolDeps } from './deps';
import { getStringField } from './readShared';
import { resolveExternalToolPath } from './resolveExternalToolPath';

export function createListExternalTool(deps: ObsidianToolDeps): ToolSpec {
  return {
    name: TOOL_OBSIDIAN_LIST_EXTERNAL,
    label: 'List external folder',
    description: 'List direct children of an external folder by absolute path, or by a vault-relative path that is resolved against the current vault.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path, or a vault-relative path such as .pivi/skills/demo' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const requestedPath = getStringField(input, 'path');
      if (!requestedPath) {
        throw new Error('Invalid list external input: path must be an absolute string.');
      }
      const absolutePath = resolveExternalToolPath(deps, requestedPath);
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
