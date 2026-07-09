import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
} from '@pivi/pivi-agent-core/tools';

import { t } from '@/i18n';
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
    expect(t(findToolRow(TOOL_OBSIDIAN_EDIT).labelKey)).toBe('Edit');
    expect(`${t(findToolRow(TOOL_OBSIDIAN_EDIT).labelKey)} (${TOOL_OBSIDIAN_EDIT})`).toBe('Edit (obsidian_edit)');
    expect(t(findToolRow(TOOL_OBSIDIAN_LIST).labelKey)).toBe('List');
    expect(t(findToolRow(TOOL_OBSIDIAN_BASH).labelKey)).toBe('Bash');
  });

  it('marks CLI-backed tools as requiring the official Obsidian CLI', () => {
    expect(findToolRow(TOOL_OBSIDIAN_PROPERTIES).requiresOfficialCli).toBeFalsy();
    expect(findToolRow(TOOL_OBSIDIAN_TASKS).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_HISTORY).requiresOfficialCli).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_DAILY).requiresOfficialCli).toBe(true);
  });

  it('registers in-process tools that do not require the official CLI', () => {
    expect(findToolRow(TOOL_OBSIDIAN_GRAPH).requiresOfficialCli).toBeFalsy();
    expect(findToolRow(TOOL_OBSIDIAN_TAGS).requiresOfficialCli).toBeFalsy();
    expect(findToolRow(TOOL_OBSIDIAN_BASE).requiresOfficialCli).toBeFalsy();
  });

  it('marks external filesystem tools as requiring external read permission', () => {
    expect(findToolRow(TOOL_OBSIDIAN_READ_EXTERNAL).requiresExternalRead).toBe(true);
    expect(findToolRow(TOOL_OBSIDIAN_LIST_EXTERNAL).requiresExternalRead).toBe(true);
  });
});
