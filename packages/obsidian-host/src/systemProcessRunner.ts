import { spawn } from 'node:child_process';

import type { ProcessRunner, ProcessRunRequest, ProcessRunResult } from '@pivi/pivi-agent-core/ports';

export const DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT = 256 * 1024;

function appendBoundedOutput(
  current: string,
  chunk: Buffer,
  byteLimit: number,
): { value: string; truncated: boolean } {
  if (current.length >= byteLimit) {
    return { value: current, truncated: true };
  }

  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next, 'utf8') <= byteLimit) {
    return { value: next, truncated: false };
  }

  let truncated = next;
  while (truncated.length > 0 && Buffer.byteLength(truncated, 'utf8') > byteLimit) {
    truncated = truncated.slice(0, Math.max(0, truncated.length - 1024));
  }
  return { value: truncated, truncated: true };
}

export const systemProcessRunner: ProcessRunner = {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const { promise, resolve, reject } = createPromiseResolvers<ProcessRunResult>();
    const outputByteLimit = request.outputByteLimit ?? DEFAULT_PROCESS_OUTPUT_BYTE_LIMIT;
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: request.shell,
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    child.stdout.on('data', (chunk: Buffer) => {
      const next = appendBoundedOutput(stdout, chunk, outputByteLimit);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const next = appendBoundedOutput(stderr, chunk, outputByteLimit);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
    });

    const timeout = request.timeoutMs === undefined
      ? null
      : window.setTimeout(() => {
        child.kill();
        reject(new Error(`Process timed out after ${request.timeoutMs}ms: ${request.command}`));
      }, request.timeoutMs);

    const clearProcessTimeout = (): void => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };

    child.on('error', (error) => {
      clearProcessTimeout();
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearProcessTimeout();
      resolve({
        exitCode: code,
        signal: signal ?? null,
        stdout,
        stderr,
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
        ...(stderrTruncated ? { stderrTruncated: true } : {}),
      });
    });

    return promise;
  },
};

function createPromiseResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
