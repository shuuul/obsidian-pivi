import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ProcessCwdPolicy,
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
  ProcessShellPolicy,
  ProcessTerminationKind,
} from '@pivi/pivi-agent-core/ports';

import { isPathWithinDirectory, normalizePathForFilesystem } from './path';

export const DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT = 256 * 1024;
export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;

const FORCE_KILL_GRACE_MS = 2_000;

type SettledTermination = {
  termination: ProcessTerminationKind;
  exitCode: number | null;
  signal: string | null;
  spawnError?: string;
  forcedKillAfter?: 'timeout' | 'abort' | 'signal';
};

class BoundedStreamCollector {
  private chunks: Buffer[] = [];
  private storedBytes = 0;
  private truncated = false;

  constructor(private readonly byteLimit: number) {
    if (!Number.isFinite(byteLimit) || byteLimit < 0) {
      throw new Error(`Invalid process output byte limit: ${byteLimit}`);
    }
  }

  write(chunk: Buffer): void {
    if (this.truncated) {
      return;
    }
    if (this.storedBytes >= this.byteLimit) {
      this.truncated = true;
      return;
    }
    const remaining = this.byteLimit - this.storedBytes;
    if (chunk.length <= remaining) {
      this.chunks.push(chunk);
      this.storedBytes += chunk.length;
      return;
    }
    if (remaining > 0) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.storedBytes += remaining;
    }
    this.truncated = true;
  }

  toStringUtf8(): string {
    if (this.chunks.length === 0) {
      return '';
    }
    const buffer = Buffer.concat(this.chunks, this.storedBytes);
    this.chunks = [];
    return decodeUtf8Bounded(buffer);
  }

  get wasTruncated(): boolean {
    return this.truncated;
  }
}

function decodeUtf8Bounded(buffer: Buffer): string {
  let end = buffer.length;
  // Strip a trailing incomplete UTF-8 sequence so truncation stays deterministic.
  while (end > 0) {
    const lead = buffer[end - 1]!;
    if ((lead & 0b1000_0000) === 0) {
      break;
    }
    let start = end - 1;
    while (start > 0 && (buffer[start]! & 0b1100_0000) === 0b1000_0000) {
      start -= 1;
    }
    const first = buffer[start]!;
    const expected =
      (first & 0b1110_0000) === 0b1100_0000 ? 2
        : (first & 0b1111_0000) === 0b1110_0000 ? 3
          : (first & 0b1111_1000) === 0b1111_0000 ? 4
            : 1;
    if (end - start === expected) {
      break;
    }
    end = start;
  }
  return buffer.subarray(0, end).toString('utf8');
}

function policyRoot(policy: ProcessCwdPolicy): string {
  return policy.mode === 'vault' ? policy.vaultRoot : policy.root;
}

function resolveConstrainedCwd(request: ProcessRunRequest): string {
  const root = normalizePathForFilesystem(policyRoot(request.cwdPolicy));
  if (!root || !path.isAbsolute(root)) {
    throw new Error('Process cwd policy root must be an absolute path');
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Process cwd policy root is not a directory: ${root}`);
  }

  const requested = typeof request.cwd === 'string' && request.cwd.trim()
    ? request.cwd.trim()
    : root;
  const normalizedRequested = normalizePathForFilesystem(requested);
  const absolute = path.isAbsolute(normalizedRequested)
    ? normalizedRequested
    : path.resolve(root, normalizedRequested);

  if (!isPathWithinDirectory(absolute, root, root)) {
    throw new Error(`Process cwd escapes approved root: ${absolute}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`Process cwd is not a directory: ${absolute}`);
  }
  return absolute;
}

function assertShellPolicy(shell: ProcessShellPolicy): boolean {
  if (shell.mode === 'forbidden') {
    return false;
  }
  if (!shell.reason.trim()) {
    throw new Error('Reviewed shell adapter requires a non-empty reason');
  }
  return true;
}

function killProcessTree(child: ChildProcess, signalName: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try {
        child.kill();
      } catch {
        // Best-effort termination.
      }
    }
    return;
  }

  try {
    // Negative PID targets the process group created with detached:true.
    process.kill(-pid, signalName);
  } catch {
    try {
      child.kill(signalName);
    } catch {
      // Best-effort termination.
    }
  }
}

function createPromiseResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

export const systemProcessRunner: ProcessRunner = {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const { promise, resolve } = createPromiseResolvers<ProcessRunResult>();
    let settled = false;

    const finish = (partial: SettledTermination, stdout: string, stderr: string, stdoutTruncated: boolean, stderrTruncated: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        termination: partial.termination,
        exitCode: partial.exitCode,
        signal: partial.signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        ...(partial.spawnError ? { spawnError: partial.spawnError } : {}),
        ...(partial.forcedKillAfter ? { forcedKillAfter: partial.forcedKillAfter } : {}),
      });
    };

    let cwd: string;
    try {
      cwd = resolveConstrainedCwd(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        termination: 'spawn-error',
        exitCode: null,
        signal: null,
        spawnError: message,
      }, '', '', false, false);
      return promise;
    }

    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      finish({
        termination: 'spawn-error',
        exitCode: null,
        signal: null,
        spawnError: `Invalid process timeoutMs: ${request.timeoutMs}`,
      }, '', '', false, false);
      return promise;
    }

    let useShell: boolean;
    try {
      useShell = assertShellPolicy(request.shell);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        termination: 'spawn-error',
        exitCode: null,
        signal: null,
        spawnError: message,
      }, '', '', false, false);
      return promise;
    }

    const stdoutCollector = new BoundedStreamCollector(request.stdoutByteLimit);
    const stderrCollector = new BoundedStreamCollector(request.stderrByteLimit);

    let child: ChildProcess;
    try {
      child = spawn(request.executable, [...request.args], {
        cwd,
        env: request.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        termination: 'spawn-error',
        exitCode: null,
        signal: null,
        spawnError: message,
      }, '', '', false, false);
      return promise;
    }

    let stopReason: 'timeout' | 'abort' | null = null;
    let escalatedToForceKill = false;
    let forceKillTimer: number | null = null;
    let deadlineTimer: number | null = null;
    let abortListener: (() => void) | null = null;

    const clearTimers = (): void => {
      if (deadlineTimer !== null) {
        window.clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (forceKillTimer !== null) {
        window.clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      if (abortListener && request.signal) {
        request.signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
    };

    const beginTermination = (reason: 'timeout' | 'abort'): void => {
      if (settled || stopReason !== null) {
        return;
      }
      stopReason = reason;
      killProcessTree(child, 'SIGTERM');
      forceKillTimer = window.setTimeout(() => {
        forceKillTimer = null;
        if (settled) {
          return;
        }
        escalatedToForceKill = true;
        killProcessTree(child, 'SIGKILL');
      }, FORCE_KILL_GRACE_MS);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutCollector.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrCollector.write(chunk);
    });

    deadlineTimer = window.setTimeout(() => {
      deadlineTimer = null;
      beginTermination('timeout');
    }, request.timeoutMs);

    if (request.signal) {
      if (request.signal.aborted) {
        beginTermination('abort');
      } else {
        abortListener = () => {
          beginTermination('abort');
        };
        request.signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    child.on('error', (error) => {
      clearTimers();
      finish({
        termination: 'spawn-error',
        exitCode: null,
        signal: null,
        spawnError: error.message,
      }, stdoutCollector.toStringUtf8(), stderrCollector.toStringUtf8(), stdoutCollector.wasTruncated, stderrCollector.wasTruncated);
    });

    child.on('close', (code, signal) => {
      clearTimers();
      const stdout = stdoutCollector.toStringUtf8();
      const stderr = stderrCollector.toStringUtf8();
      const stdoutTruncated = stdoutCollector.wasTruncated;
      const stderrTruncated = stderrCollector.wasTruncated;

      if (stopReason === 'timeout' || stopReason === 'abort') {
        if (escalatedToForceKill) {
          finish({
            termination: 'forced-kill',
            exitCode: code,
            signal: signal ?? null,
            forcedKillAfter: stopReason,
          }, stdout, stderr, stdoutTruncated, stderrTruncated);
          return;
        }
        finish({
          termination: stopReason,
          exitCode: code,
          signal: signal ?? null,
        }, stdout, stderr, stdoutTruncated, stderrTruncated);
        return;
      }

      if (signal) {
        finish({
          termination: 'signal',
          exitCode: null,
          signal,
        }, stdout, stderr, stdoutTruncated, stderrTruncated);
        return;
      }

      finish({
        termination: 'exit',
        exitCode: code,
        signal: null,
      }, stdout, stderr, stdoutTruncated, stderrTruncated);
    });

    return promise;
  },
};
