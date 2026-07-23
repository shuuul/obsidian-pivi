import { spawn } from 'node:child_process';

import {
  DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT,
  systemProcessRunner,
} from '@pivi/obsidian-host/systemProcessRunner';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

function mockChild(events: {
  stdout?: string[];
  stderr?: string[];
  close?: { code: number | null; signal?: NodeJS.Signals | null };
  error?: Error;
}) {
  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const stderrHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const errorHandlers: Array<(error: Error) => void> = [];

  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      for (const chunk of events.stdout ?? []) stdoutHandlers.forEach((handler) => handler(Buffer.from(chunk)));
      for (const chunk of events.stderr ?? []) stderrHandlers.forEach((handler) => handler(Buffer.from(chunk)));
      if (events.error) errorHandlers.forEach((handler) => handler(events.error!));
      if (events.close) closeHandlers.forEach((handler) => handler(events.close!.code, events.close!.signal ?? null));
    });

    return {
      stdout: { on: (_event: string, handler: (chunk: Buffer) => void) => stdoutHandlers.push(handler) },
      stderr: { on: (_event: string, handler: (chunk: Buffer) => void) => stderrHandlers.push(handler) },
      on: (event: string, handler: (...args: never[]) => void) => {
        if (event === 'close') closeHandlers.push(handler as typeof closeHandlers[number]);
        if (event === 'error') errorHandlers.push(handler as typeof errorHandlers[number]);
      },
      kill: jest.fn(),
    } as never;
  });
}

describe('systemProcessRunner', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('reports signal termination instead of exit code 0', async () => {
    mockChild({ close: { code: null, signal: 'SIGTERM' } });

    const result = await systemProcessRunner.run({ command: 'node', args: ['server.js'] });

    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGTERM');
  });

  it('bounds stdout and stderr with truncation metadata', async () => {
    const limit = 32;
    mockChild({
      stdout: ['a'.repeat(limit + 10)],
      stderr: ['b'.repeat(limit + 10)],
      close: { code: 0, signal: null },
    });

    const result = await systemProcessRunner.run({
      command: 'node',
      args: ['server.js'],
      outputByteLimit: limit,
    });

    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(limit);
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(limit);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT).toBeGreaterThan(limit);
  });
});
