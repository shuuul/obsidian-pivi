import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_TASKS,
} from '@pivi/pivi-agent-core/tools';

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
      enabled: false,
      available: true,
    });
    expect(rows.find((row) => row.name === TOOL_OBSIDIAN_TASKS)).toMatchObject({
      enabled: false,
      available: false,
    });
    expect(rows.find((row) => row.name === TOOL_OBSIDIAN_BASH)).toMatchObject({
      enabled: true,
      available: true,
    });
  });

  it('describes and runs Obsidian-only integration actions', async () => {
    const openStyleSettings = jest.fn(async () => false);
    const setupNoteToolbarIntegration = jest.fn(async () => ({
      status: 'installed' as const,
    }));
    const host = { openStyleSettings, setupNoteToolbarIntegration } as unknown as PiviSettingsHost;
    const sections = listObsidianIntegrationSections();

    await expect(runObsidianIntegrationAction(
      host,
      sections[0]!.actions[0]!.id,
    )).resolves.toEqual({
      message: 'The Style Settings plugin page was opened. Install or enable it, then return to Integrations.',
    });
    await expect(runObsidianIntegrationAction(
      host,
      sections[1]!.actions[0]!.id,
    )).resolves.toEqual({ message: 'Added Pivi to the selected-text toolbar.' });
    expect(setupNoteToolbarIntegration).toHaveBeenCalledWith('label-and-icon');
  });

  it('rejects action ids that were not supplied by the host adapter', async () => {
    await expect(runObsidianIntegrationAction(
      {} as PiviSettingsHost,
      'other-host:unknown',
    )).rejects.toThrow('Unknown Obsidian integration action');
  });
});
