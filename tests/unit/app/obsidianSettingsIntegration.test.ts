import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_TASKS,
  TOOL_PIVI_COMMANDS,
  TOOL_PIVI_MCP,
  TOOL_PIVI_PROMPT,
  TOOL_PIVI_SESSIONS,
  TOOL_PIVI_SKILLS,
} from '@pivi/agent/tools';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { setLocale } from '@/app/i18n';
import {
  createObsidianToolRows,
  listObsidianIntegrationSections,
  runObsidianIntegrationAction,
} from '@/app/ui/obsidianSettingsIntegration';

jest.mock('@/app/hostPlatform', () => ({
  isOfficialObsidianCliEnabled: () => false,
}));

describe('Obsidian settings integration adapter', () => {
  beforeEach(() => setLocale('en'));

  it('projects host tool availability without exposing host rules to React', () => {
    const rows = createObsidianToolRows({
      allowBash: true,
      allowExternalRead: false,
      disabledTools: [TOOL_OBSIDIAN_READ],
    }, false);

    expect(rows.find((row) => row.name === TOOL_OBSIDIAN_READ)).toMatchObject({
      group: 'workspace-api',
      enabled: false,
      available: true,
    });
    expect(rows.find((row) => row.name === TOOL_OBSIDIAN_TASKS)).toMatchObject({
      group: 'host-cli',
      enabled: false,
      available: false,
    });
    expect(rows.find((row) => row.name === TOOL_OBSIDIAN_BASH)).toMatchObject({
      group: 'additional',
      enabled: true,
      available: true,
    });
    expect(rows.find((row) => row.name === TOOL_PIVI_SESSIONS)).toMatchObject({
      label: 'Pivi Sessions',
      description: 'Read durable sessions, list recoverable deleted sessions, or restore one in a visible Pivi tab.',
      group: 'pivi',
      enabled: true,
      available: true,
    });
    expect(rows.filter(row => [TOOL_PIVI_MCP, TOOL_PIVI_SKILLS, TOOL_PIVI_COMMANDS, TOOL_PIVI_PROMPT]
      .includes(row.name as typeof TOOL_PIVI_MCP))).toEqual([
      expect.objectContaining({ name: TOOL_PIVI_MCP, group: 'pivi', enabled: true }),
      expect.objectContaining({ name: TOOL_PIVI_SKILLS, group: 'pivi', enabled: true }),
      expect.objectContaining({ name: TOOL_PIVI_COMMANDS, group: 'pivi', enabled: true }),
      expect.objectContaining({ name: TOOL_PIVI_PROMPT, group: 'pivi', enabled: true }),
    ]);

    const disabled = createObsidianToolRows({
      allowBash: true,
      allowExternalRead: false,
      disabledTools: [TOOL_PIVI_MCP],
    }, false);
    expect(disabled.find(row => row.name === TOOL_PIVI_MCP)?.enabled).toBe(false);
  });

  it('describes and runs Obsidian-only integration actions', async () => {
    const openStyleSettings = jest.fn(async () => false);
    const setupNoteToolbarIntegration = jest.fn(async () => ({
      status: 'installed' as const,
    }));
    const host = { openStyleSettings, setupNoteToolbarIntegration } as unknown as PiviSettingsHost;
    const sections = listObsidianIntegrationSections(true);

    await expect(runObsidianIntegrationAction(
      host,
      sections[0]!.actions[0]!.id,
    )).resolves.toEqual({
      feedback: {
        kind: 'error',
        message: 'The Style Settings plugin page was opened. Install or enable it, then return to General.',
      },
    });
    await expect(runObsidianIntegrationAction(
      host,
      sections[1]!.actions[0]!.id,
    )).resolves.toEqual({ feedback: { kind: 'success', message: 'Added Pivi to the selected-text toolbar.' } });
    expect(setupNoteToolbarIntegration).toHaveBeenCalledWith('label-and-icon');
  });

  it('disables only Note Toolbar actions when the plugin is not installed', () => {
    const sections = listObsidianIntegrationSections(false);

    expect(sections[0]?.actions[0]?.disabled).toBeUndefined();
    expect(sections[1]?.actions).toEqual([
      expect.objectContaining({ disabled: true, disabledReason: 'Install Note Toolbar to use this action.' }),
      expect.objectContaining({ disabled: true, disabledReason: 'Install Note Toolbar to use this action.' }),
    ]);
  });

  it('rejects action ids that were not supplied by the host adapter', async () => {
    await expect(runObsidianIntegrationAction(
      {} as PiviSettingsHost,
      'other-host:unknown',
    )).rejects.toThrow('Unknown Obsidian integration action');
  });
});
