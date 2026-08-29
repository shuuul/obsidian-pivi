import { createObsidianTools } from '@pivi/obsidian-tools';
import { TOOL_PIVI_SESSIONS } from '@pivi/agent/tools';

import { createBaseSessionTools } from '@/app/runtime/baseSessionTools';

const settings = {
  cliEnabled: false,
  cliPath: null,
  cliTimeoutMs: 30_000,
  disabledTools: [],
  allowCommand: false,
  commandAllowlist: [],
  allowBash: false,
  bashAllowlist: [],
  allowEval: false,
  allowExternalRead: false,
  externalReadDirectories: [],
};

const recovery = {
  read: jest.fn(async () => ''),
  listDeleted: jest.fn(async () => []),
  restore: jest.fn(async (sessionFile: string) => ({ sessionId: 'id', title: 'title', sessionFile })),
};

describe('base session tool composition', () => {
  it('adds exactly one shared pivi_sessions tool outside obsidian-tools', () => {
    const app = { vault: { getName: () => 'vault' }, workspace: { getActiveFile: () => null } };
    const obsidianTools = createObsidianTools(app as never, settings);
    const composed = [...obsidianTools, ...createBaseSessionTools(recovery)];

    expect(obsidianTools.map(tool => tool.name)).not.toContain(TOOL_PIVI_SESSIONS);
    expect(composed.filter(tool => tool.name === TOOL_PIVI_SESSIONS)).toHaveLength(1);
  });

  it('preserves disabled-tool filtering', () => {
    expect(createBaseSessionTools(recovery, [TOOL_PIVI_SESSIONS])).toEqual([]);
  });
});
