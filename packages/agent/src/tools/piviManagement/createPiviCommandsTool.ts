import { TOOL_PIVI_COMMANDS } from '../obsidianToolNames';
import type { ToolSpec } from '../toolSpec';
import { createPiviManagementTool } from './createPiviManagementTool';
import type { PiviManagementPort } from './port';
import { PIVI_COMMANDS_PARAMETERS } from './schemas';
import { parsePiviCommandsInput } from './validate';

export function createPiviCommandsTool(port: PiviManagementPort): ToolSpec {
  return createPiviManagementTool({
    name: TOOL_PIVI_COMMANDS,
    label: 'Pivi Commands',
    description: [
      'Query and manage vault-local Pivi slash Commands (.pivi/commands/).',
      'Actions: list, get, upsert, remove, move.',
      'Agent input is limited to id/name/description/argumentHint/icon/content;',
      'integration keys and identity policy are Pivi-owned.',
      'upsert, remove, and move require catalogRevision from a prior list/get.',
      'Mutations require one sidebar confirmation.',
    ].join(' '),
    parameters: PIVI_COMMANDS_PARAMETERS,
    promptUsage: {
      summary: 'Query and manage vault-local Pivi slash Commands; list omits prompt bodies; get returns one command; upsert, remove, and move require catalogRevision',
      parameters: '`action` required list|get|upsert|remove|move; `id` required except list; `content` required for upsert; optional upsert `name`/`description`/`argumentHint`/`icon`; upsert, remove, and move require `catalogRevision`; move also requires exactly one of `beforeId`/`afterId`.',
    },
    metadata: { displayKind: 'other' },
    parse: parsePiviCommandsInput,
    execute: (input, signal) => port.executeCommands(input, signal),
  });
}
