import { createHistoryTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

interface FakeVersion {
  timestamp: string;
  size: string;
  content: string;
}

interface TextToolResult {
  content: [{ type: 'text'; text: string }];
  details: Record<string, unknown>;
}

/**
 * In-memory File Recovery + CLI simulator mirroring the real app semantics the
 * version-shift bug depends on: the newest version is 1, every content write
 * prepends a snapshot, and `history:restore version=<n>` resolves the number
 * against the version list as it exists at that moment. See issue #138.
 */
function createRestoreHarness() {
  let currentContent = 'summary';
  const versions: FakeVersion[] = [];
  const restoreCalls: number[] = [];

  const snapshotCurrent = (timestamp: string) => {
    versions.unshift({ timestamp, size: `${currentContent.length}B`, content: currentContent });
  };

  const renderList = () => [
    'notes/a.md',
    ...versions.map((entry, index) => `${index + 1}\t${entry.timestamp}\t${entry.size}`),
  ].join('\n');

  let restoreSkipsWrite = false;
  let snapshotBeforeMutation = true;
  let mutateVersionListDuringSnapshot = false;

  const cli = {
    run: jest.fn(async ({ args }: { args: string[] }) => {
      const command = args[0];
      if (command === 'history') {
        return renderList();
      }
      if (command === 'history:restore') {
        const requested = args.find((arg) => arg.startsWith('version='))?.slice('version='.length);
        const version = Number(requested);
        if (!Number.isInteger(version) || version < 1 || version > versions.length) {
          throw new Error(`Invalid history version: ${requested}`);
        }
        restoreCalls.push(version);
        if (!restoreSkipsWrite) {
          const selected = versions[version - 1];
          if (!selected) {
            throw new Error(`Invalid history version: ${requested}`);
          }
          currentContent = selected.content;
          versions.unshift({
            timestamp: `restored-from-${version}`,
            size: `${currentContent.length}B`,
            content: currentContent,
          });
        }
        return `Restored: notes/a.md to version ${version}`;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    }),
  };

  const vault = {
    resolveFile: jest.fn(() => ({ path: 'notes/a.md' })),
    runCliMutation: jest.fn(async (_path: string, mutate: () => Promise<unknown>) => {
      // The real host always captures a File Recovery snapshot of the existing
      // destination immediately before the CLI mutation.
      if (snapshotBeforeMutation) {
        snapshotCurrent('2026-09-13 14:44');
        if (mutateVersionListDuringSnapshot) {
          versions.pop();
        }
      }
      return mutate();
    }),
  };

  const deps = {
    vault,
    cli,
    vaultName: 'vault',
    vaultPath: '/vault',
  } as never as ObsidianToolDeps;

  return {
    tool: createHistoryTool(deps),
    versions,
    restoreCalls,
    content: () => currentContent,
    setSnapshotBeforeMutation(value: boolean) {
      snapshotBeforeMutation = value;
    },
    setRestoreSkipsWrite(value: boolean) {
      restoreSkipsWrite = value;
    },
    setMutateVersionListDuringSnapshot(value: boolean) {
      mutateVersionListDuringSnapshot = value;
    },
  };
}

function seedSummaryAndOriginal(harness: ReturnType<typeof createRestoreHarness>): void {
  // Newest-first, mirroring the observed real-vault shape: two summary saves
  // followed by the longer pre-summary originals. Sizes derive from content so
  // the fake CLI's own snapshot formatting stays consistent with its rows.
  const sizeOf = (content: string) => `${content.length}B`;
  harness.versions.push(
    { timestamp: '2026-09-13 14:23', size: sizeOf('summary'), content: 'summary' },
    { timestamp: '2026-09-13 14:07', size: sizeOf('summary-earlier'), content: 'summary-earlier' },
    { timestamp: '2026-09-13 14:01', size: sizeOf('ORIGINAL'), content: 'ORIGINAL' },
    { timestamp: '2026-09-13 13:56', size: sizeOf('ORIGINAL-earlier'), content: 'ORIGINAL-earlier' },
  );
}

describe('createHistoryTool restore version anchoring', () => {
  it('re-anchors the requested version after the mandatory pre-restore snapshot', async () => {
    const harness = createRestoreHarness();
    seedSummaryAndOriginal(harness);

    const result = await harness.tool.execute('call', {
      action: 'restore',
      path: 'notes/a.md',
      version: 3,
    }) as TextToolResult;

    expect(harness.content()).toBe('ORIGINAL');
    expect(harness.restoreCalls).toEqual([4]);
    expect(result.content[0].text).toContain('resolved to version 4');
    expect(result.details).toMatchObject({ version: 3, resolvedVersion: 4 });
  });

  it('restores the requested number unchanged when no snapshot shifts the list', async () => {
    const harness = createRestoreHarness();
    seedSummaryAndOriginal(harness);
    // A destination without a pre-restore snapshot leaves the numbering intact.
    harness.setSnapshotBeforeMutation(false);

    const result = await harness.tool.execute('call', {
      action: 'restore',
      path: 'notes/a.md',
      version: 3,
    }) as TextToolResult;

    expect(harness.content()).toBe('ORIGINAL');
    expect(harness.restoreCalls).toEqual([3]);
    expect(result.content[0].text).not.toContain('resolved to');
  });

  it('fails loudly instead of guessing when the version list changed concurrently', async () => {
    const harness = createRestoreHarness();
    seedSummaryAndOriginal(harness);
    harness.setMutateVersionListDuringSnapshot(true);

    await expect(harness.tool.execute('call', {
      action: 'restore',
      path: 'notes/a.md',
      version: 3,
    })).rejects.toThrow(/changed while preparing the restore/i);
    expect(harness.restoreCalls).toEqual([]);
  });

  it('fails loudly when the CLI reports success without applying the restore', async () => {
    const harness = createRestoreHarness();
    seedSummaryAndOriginal(harness);
    harness.setRestoreSkipsWrite(true);

    await expect(harness.tool.execute('call', {
      action: 'restore',
      path: 'notes/a.md',
      version: 3,
    })).rejects.toThrow(/did not apply/i);
  });

  it('rejects out-of-range version numbers before mutating anything', async () => {
    const harness = createRestoreHarness();
    seedSummaryAndOriginal(harness);

    await expect(harness.tool.execute('call', {
      action: 'restore',
      path: 'notes/a.md',
      version: 9,
    })).rejects.toThrow(/does not exist/i);
    expect(harness.restoreCalls).toEqual([]);
  });
});
