import { spawn } from 'child_process';

import type { ObsidianToolsSettings } from '../../core/types/settings';

export interface CliRunOptions {
  args: string[];
  vaultName: string;
}

export class ObsidianCliTransport {
  constructor(
    private readonly settings: ObsidianToolsSettings,
    private readonly obsidianBinary = 'obsidian',
  ) {}

  async run(options: CliRunOptions): Promise<string> {
    if (!this.settings.cliEnabled) {
      throw new Error('Obsidian CLI transport is disabled in settings.');
    }

    const fullArgs = [`vault=${options.vaultName}`, ...options.args];
    return await this.spawn(fullArgs);
  }

  private spawn(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.obsidianBinary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = window.setTimeout(() => {
        child.kill();
        reject(new Error(`Obsidian CLI timed out after ${this.settings.cliTimeoutMs}ms`));
      }, this.settings.cliTimeoutMs);

      child.on('error', (error) => {
        window.clearTimeout(timeout);
        reject(new Error(`Failed to run obsidian CLI: ${error.message}. Ensure Obsidian 1.12+ CLI is on PATH.`));
      });

      child.on('close', (code) => {
        window.clearTimeout(timeout);
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
          reject(new Error(`Obsidian CLI failed: ${detail}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
