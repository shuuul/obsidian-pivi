import { spawn } from 'node:child_process';

import type { ProcessRunner, ProcessRunRequest, ProcessRunResult } from '@pivi/pivi-agent-core/ports';

export const systemProcessRunner: ProcessRunner = {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const { promise, resolve, reject } = createPromiseResolvers<ProcessRunResult>();
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: request.shell,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
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

    child.on('close', (code) => {
      clearProcessTimeout();
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
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
  // @ts-expect-error Promise.withResolvers needs ES2024 lib; runtime is Node 24+.
  return (Promise as any).withResolvers<T>() as {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}
