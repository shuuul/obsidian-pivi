import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const rootDir = resolve(__dirname, '../../..');
const scriptPath = join(rootDir, 'scripts/summarize-projection-traces.mjs');

function writeTrace(path: string, durationMs: number, visitedEntities: number): void {
  writeFileSync(path, JSON.stringify({
    schema: 'pivi-chat-perf-v2',
    scenario: 'projection-small-text-50-events-main',
    environment: { obsidianVersion: '1.13.7', piviVersion: '0.25.1' },
    projectionWorkload: {
      workload: 'small-text',
      fixtureSha256: 'fixed-fixture-sha',
      warmupEvents: 5,
      sampleEvents: 50,
    },
    events: [
      {
        type: 'projection.dispatch',
        accepted: true,
        validationDurationMs: durationMs / 2,
        totalDurationMs: durationMs,
      },
      {
        type: 'projection.snapshot',
        durationMs,
        snapshotCalls: 1,
        visitedEntities,
        clonedEntities: 2,
      },
      { type: 'projection.entity-commit', durationMs },
      { type: 'projection.commit', commitDurationMs: durationMs },
      { type: 'projection.paint', eventToPaintMs: durationMs },
      { type: 'markdown.render', durationMs },
    ],
  }));
}

describe('summarize-projection-traces', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pivi-projection-traces-'));

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('reports per-trace and cross-run timing and allocation distributions', () => {
    const first = join(directory, 'first.json');
    const second = join(directory, 'second.json');
    writeTrace(first, 1, 4);
    writeTrace(second, 3, 8);

    const result = spawnSync(process.execPath, [scriptPath, first, second], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      traces: Array<{
        projectionWorkload: {
          fixtureSha256: string;
          warmupEvents: number;
          sampleEvents: number;
        };
      }>;
      scenarios: Record<string, {
        aggregate: Record<string, {
          count: number;
          median: number;
          p95: number;
          min: number;
          max: number;
        }>;
        allocationProxies: Record<string, {
          median: number;
          p95: number;
          min: number;
          max: number;
        }>;
      }>;
    };
    expect(summary.traces[0]?.projectionWorkload).toMatchObject({
      fixtureSha256: 'fixed-fixture-sha',
      warmupEvents: 5,
      sampleEvents: 50,
    });
    const scenario = summary.scenarios['projection-small-text-50-events-main'];
    expect(scenario?.aggregate.snapshotMs).toMatchObject({
      count: 2,
      median: 1,
      p95: 3,
      min: 1,
      max: 3,
    });
    expect(scenario?.allocationProxies).toMatchObject({
      snapshotCallsPerRun: { median: 1, p95: 1, min: 1, max: 1 },
      visitedEntities: { median: 4, p95: 8, min: 4, max: 8 },
      clonedEntities: { median: 2, p95: 2, min: 2, max: 2 },
    });
  });

  it('rejects invalid metric data', () => {
    const invalid = join(directory, 'invalid.json');
    writeTrace(invalid, -1, 4);

    const result = spawnSync(process.execPath, [scriptPath, invalid], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid dispatchValidationMs value');
  });
});
