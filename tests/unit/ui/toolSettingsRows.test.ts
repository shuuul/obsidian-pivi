import {
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_PROPERTIES,
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
  it('marks CLI-backed tools as requiring the official Obsidian CLI', () => {
    expect(findToolRow(TOOL_OBSIDIAN_PROPERTIES).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_TASKS).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_HISTORY).requiresOfficialCli).toBe(true);
  });
});
