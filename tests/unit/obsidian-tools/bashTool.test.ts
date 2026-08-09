import type { ProcessRunRequest } from '@pivi/agent/ports';
import { createBashTool } from '@pivi/obsidian-tools';
import type { ObsidianToolDeps } from '@pivi/obsidian-tools';

describe('createBashTool', () => {
  it('executes the immutable invocation authorized before an async approval', async () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    const run = jest.fn(async (_request: ProcessRunRequest) => ({
      termination: 'exit' as const,
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }));
    const deps = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      settings: { bashAllowlist: [], cliTimeoutMs: 30_000 },
      processRunner: { run },
      capabilityApproval: {
        hasSessionGrant: () => false,
        clearSessionGrants: () => undefined,
        requestApproval: async () => {
          process.env.SHELL = '/bin/fish';
          return { decision: 'allow' as const };
        },
      },
    } as unknown as ObsidianToolDeps;

    try {
      await createBashTool(deps).execute('call-1', { command: 'git status' });
      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        executable: '/bin/bash',
        args: ['-lc', 'git status'],
      }));
    } finally {
      if (originalShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = originalShell;
      }
    }
  });
});
