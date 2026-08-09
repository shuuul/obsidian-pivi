import { TOOL_PIVI_SKILLS } from '../obsidianToolNames';
import type { ToolSpec } from '../toolSpec';
import { createPiviManagementTool } from './createPiviManagementTool';
import type { PiviManagementPort } from './port';
import { PIVI_SKILLS_PARAMETERS } from './schemas';
import { parsePiviSkillsInput } from './validate';

export function createPiviSkillsTool(port: PiviManagementPort): ToolSpec {
  return createPiviManagementTool({
    name: TOOL_PIVI_SKILLS,
    label: 'Pivi Skills',
    description: [
      'Query and manage Pivi vault Skills only through the pinned skills package workflow.',
      'Actions: list, list_remote, install, set_enabled, update, update_all, remove.',
      'Do not supply Skill bodies, files, SKILL.md content, source trees, or destinations.',
      'Mutations require one sidebar confirmation.',
    ].join(' '),
    parameters: PIVI_SKILLS_PARAMETERS,
    promptUsage: {
      summary: 'Query and manage vault Skills only through the pinned skills package; never supply Skill bodies, files, SKILL.md, source trees, or destinations',
      parameters: '`action` required list|list_remote|install|set_enabled|update|update_all|remove; `source` required for list_remote/install; `skillNames?` optional install filter; `name` required for set_enabled/update/remove; `enabled` required for set_enabled.',
    },
    metadata: { displayKind: 'other' },
    parse: parsePiviSkillsInput,
    execute: (input, signal) => port.executeSkills(input, signal),
  });
}
