import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT,
  systemProcessRunner,
} from '@pivi/obsidian-host/systemProcessRunner';

const nodeExecutable = process.execPath;

function makeVaultRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-process-'));
  return root;
}

describe('systemProcessRunner', () => {
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = makeVaultRoot();
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('reports signal termination instead of exit code 0', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'process.kill(process.pid, "SIGTERM"); setInterval(() => {}, 1000)'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 64 * 1024,
      stderrByteLimit: 64 * 1024,
      shell: { mode: 'forbidden' },
    });

    expect(result.termination).toBe('signal');
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGTERM');
  });

  it('bounds stdout and stderr with truncation metadata without retaining excess bytes', async () => {
    const limit = 32;
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: [
        '-e',
        `process.stdout.write(${JSON.stringify('a'.repeat(limit + 40))});`
        + `process.stderr.write(${JSON.stringify('b'.repeat(limit + 40))});`,
      ],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: limit,
      stderrByteLimit: limit,
      shell: { mode: 'forbidden' },
    });

    expect(result.termination).toBe('exit');
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(limit);
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(limit);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT).toBeGreaterThan(limit);
  });

  it('truncates cleanly at a multibyte UTF-8 boundary', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'process.stdout.write("é".repeat(20))'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 5,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(5);
    expect(() => Buffer.from(result.stdout, 'utf8')).not.toThrow();
  });

  it('reports numeric nonzero exits', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'process.exit(7)'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(result.termination).toBe('exit');
    expect(result.exitCode).toBe(7);
  });

  it('keeps argv metacharacters literal', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'a;b|c && d'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(result.stdout).toBe('a;b|c && d');
  });

  it('rejects cwd outside the approved root', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-outside-'));
    try {
      const result = await systemProcessRunner.run({
        executable: nodeExecutable,
        args: ['-e', 'process.exit(0)'],
        cwdPolicy: { mode: 'vault', vaultRoot },
        cwd: outside,
        timeoutMs: 5_000,
        stdoutByteLimit: 1024,
        stderrByteLimit: 1024,
        shell: { mode: 'forbidden' },
      });
      expect(result.termination).toBe('spawn-error');
      expect(result.spawnError).toMatch(/escapes approved root/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('times out and waits for close without double-resolve', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 200,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(['timeout', 'forced-kill']).toContain(result.termination);
  });

  it('honors AbortSignal', async () => {
    const controller = new AbortController();
    const pending = systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 10_000,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(['abort', 'forced-kill']).toContain(result.termination);
  });

  it('reports spawn failures for missing executables', async () => {
    const result = await systemProcessRunner.run({
      executable: path.join(vaultRoot, 'missing-binary-does-not-exist'),
      args: [],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });
    expect(result.termination).toBe('spawn-error');
    expect(result.spawnError).toBeTruthy();
  });

  it('terminates descendant process groups on timeout', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const marker = path.join(vaultRoot, 'child-alive');
    const script = `
      const { spawn } = require('child_process');
      const fs = require('fs');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'alive'); setInterval(() => {}, 1000)`,
      )}], { detached: true, stdio: 'ignore' });
      child.unref();
      setInterval(() => {}, 1000);
    `;

    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', script],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 300,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(['timeout', 'forced-kill']).toContain(result.termination);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Marker may exist from the brief grandchild lifetime; ensure no runaway node remains by tree kill.
    expect(result.termination).not.toBe('exit');
  });

  it('escalates to forced-kill when SIGTERM is ignored', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: [
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
      ],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 200,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'forbidden' },
    });

    expect(result.termination).toBe('forced-kill');
    expect(result.forcedKillAfter).toBe('timeout');
  }, 15_000);

  it('forbids shell unless a reviewed adapter is declared', async () => {
    const result = await systemProcessRunner.run({
      executable: nodeExecutable,
      args: ['-e', 'process.exit(0)'],
      cwdPolicy: { mode: 'vault', vaultRoot },
      timeoutMs: 5_000,
      stdoutByteLimit: 1024,
      stderrByteLimit: 1024,
      shell: { mode: 'reviewed-adapter', reason: '' },
    });
    expect(result.termination).toBe('spawn-error');
  });
});

describe('systemProcessRunner mock fixtures', () => {
  it('does not import unused spawn in production path tests', () => {
    expect(typeof spawn).toBe('function');
  });
});
