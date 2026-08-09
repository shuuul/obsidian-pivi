import { TOOL_PIVI_MCP } from '../obsidianToolNames';
import type { ToolSpec } from '../toolSpec';
import { createPiviManagementTool } from './createPiviManagementTool';
import type { PiviManagementPort } from './port';
import { PIVI_MCP_PARAMETERS } from './schemas';
import { parsePiviMcpInput } from './validate';

export function createPiviMcpTool(port: PiviManagementPort): ToolSpec {
  return createPiviManagementTool({
    name: TOOL_PIVI_MCP,
    label: 'Pivi MCP',
    description: [
      'Query and manage vault-local MCP servers (.pivi/mcp.json).',
      'Actions: list, test, upsert, set_enabled, remove.',
      'Never pass raw bearer tokens, OAuth client secrets, or secret header/env values;',
      'use structured value sources (plain, systemEnvironment, clear) only.',
      'Mutations require one sidebar confirmation and return a sanitized effective state.',
    ].join(' '),
    parameters: PIVI_MCP_PARAMETERS,
    promptUsage: {
      summary: 'Query and manage vault-local MCP servers; list/test are non-mutating; upsert/set_enabled/remove require confirmation; never pass raw secrets',
      parameters: '`action` required list|test|upsert|set_enabled|remove; `name` required except list; `server` required for upsert (typed remote/stdio config with structured value sources only); `enabled` required for set_enabled.',
    },
    metadata: { displayKind: 'mcp' },
    parse: parsePiviMcpInput,
    execute: (input, signal) => port.executeMcp(input, signal),
  });
}
