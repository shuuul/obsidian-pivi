import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_TASKS,
} from '@pivi/pivi-agent-core/tools';

import { TOOL_SETTINGS_ROWS } from '@/ui/settings/piviSettingsHotkeys';

function findToolRow(name: string) {
  const row = TOOL_SETTINGS_ROWS.find((candidate) => candidate.name === name);
  if (!row) {
    throw new Error(`Missing tool row for ${name}`);
  }
  return row;
}

describe('TOOL_SETTINGS_ROWS', () => {
  it('uses short aliases while showing the raw tool name in settings', () => {
    expect(findToolRow(TOOL_OBSIDIAN_EDIT).label).toBe('Edit');
    expect(`${findToolRow(TOOL_OBSIDIAN_EDIT).label} (${TOOL_OBSIDIAN_EDIT})`).toBe('Edit (obsidian_edit)');
    expect(findToolRow(TOOL_OBSIDIAN_LIST).label).toBe('List');
    expect(findToolRow(TOOL_OBSIDIAN_BASH).label).toBe('Bash');
  });

  it('marks CLI-backed tools as requiring the official Obsidian CLI', () => {
    expect(findToolRow(TOOL_OBSIDIAN_PROPERTIES).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_TASKS).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_HISTORY).requiresOfficialCli).toBe(true);
  });

  it('marks external filesystem tools as requiring external read permission', () => {
    expect(findToolRow(TOOL_OBSIDIAN_READ_EXTERNAL).requiresExternalRead).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_LIST_EXTERNAL).requiresExternalRead).toBe(true);
  });
});
