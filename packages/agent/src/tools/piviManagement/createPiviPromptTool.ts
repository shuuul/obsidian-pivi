import { TOOL_PIVI_PROMPT } from '../obsidianToolNames';
import type { ToolSpec } from '../toolSpec';
import { createPiviManagementTool } from './createPiviManagementTool';
import type { PiviManagementPort } from './port';
import { PIVI_PROMPT_PARAMETERS } from './schemas';
import { parsePiviPromptInput } from './validate';

export function createPiviPromptTool(port: PiviManagementPort): ToolSpec {
  return createPiviManagementTool({
    name: TOOL_PIVI_PROMPT,
    label: 'Pivi Prompt',
    description: [
      'Query and manage vault system-prompt modules (Settings → Prompt).',
      'Actions: list, get, set_enabled, set_body, restore, upsert, remove, move.',
      'list omits bodies; get returns one module.',
      'Core modules are read-only. Workflow modules accept set_enabled, set_body, and restore.',
      'Custom modules accept upsert (omit id to create), set_enabled, remove, and move.',
      'Mutations require catalogRevision from a prior list/get and one sidebar confirmation.',
      'Do not edit .pivi/settings.json for prompt composition.',
    ].join(' '),
    parameters: PIVI_PROMPT_PARAMETERS,
    promptUsage: {
      summary: 'Query and manage system-prompt modules; list omits bodies; core is read-only; mutations require catalogRevision; do not edit .pivi/settings.json',
      parameters: '`action` required list|get|set_enabled|set_body|restore|upsert|remove|move; `id` required except list and create-upsert; `body` required for set_body and create-upsert; `enabled` required for set_enabled; upsert/remove/move/set_enabled/set_body/restore require `catalogRevision`; move also requires exactly one of `beforeId`/`afterId`.',
    },
    metadata: { displayKind: 'other' },
    parse: parsePiviPromptInput,
    execute: (input, signal) => port.executePrompt(input, signal),
  });
}
