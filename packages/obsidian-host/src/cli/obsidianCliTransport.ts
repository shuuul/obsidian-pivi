import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { ProcessRunner } from '@pivi/pivi-agent-core/ports';

import { augmentPathForSpawn, resolveObsidianCliBinary } from './obsidianCliPath';
import { isOfficialObsidianCliEnabled } from './officialObsidianCli';

export interface CliRunOptions {
  args: string[];
  vaultName: string;
  signal?: AbortSignal;
}

export interface ObsidianCliTransportOptions {
  processRunner: ProcessRunner;
  vaultPath: string | null;
}

const CLI_OUTPUT_BYTE_LIMIT = 1024 * 1024;

export class ObsidianCliTransport {
  private readonly obsidianBinary: string;
  private readonly processRunner: ProcessRunner;
  private readonly vaultPath: string | null;

  constructor(
    private readonly settings: ObsidianToolsSettings,
    options: ObsidianCliTransportOptions,
  ) {
    this.obsidianBinary = resolveObsidianCliBinary(settings.cliPath);
    this.processRunner = options.processRunner;
    this.vaultPath = options.vaultPath;
  }

  async run(options: CliRunOptions): Promise<string> {
    if (!this.settings.cliEnabled) {
      throw new Error('Obsidian CLI transport is disabled in settings.');
    }
    if (!isOfficialObsidianCliEnabled()) {
      throw new Error(
        'Obsidian CLI is not enabled in Obsidian. Enable it in Obsidian Settings → General → Command line interface, then retry.',
      );
    }
    if (!this.vaultPath) {
      throw new Error('Vault path is unavailable for Obsidian CLI cwd containment.');
    }

    const fullArgs = [`vault=${options.vaultName}`, ...options.args];
    const result = await this.processRunner.run({
      executable: this.obsidianBinary,
      args: fullArgs,
      cwdPolicy: { mode: 'vault', vaultRoot: this.vaultPath },
      env: augmentPathForSpawn(process.env),
      timeoutMs: this.settings.cliTimeoutMs,
      stdoutByteLimit: CLI_OUTPUT_BYTE_LIMIT,
      stderrByteLimit: CLI_OUTPUT_BYTE_LIMIT,
      shell: { mode: 'forbidden' },
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (result.termination === 'spawn-error') {
      throw new Error(
        `Failed to run obsidian CLI (${this.obsidianBinary}): ${result.spawnError ?? 'spawn failed'}. `
        + 'Enable CLI in Obsidian Settings → General, or set agentSettings.obsidianTools.cliPath.',
      );
    }
    if (result.termination === 'timeout') {
      throw new Error(`Obsidian CLI timed out after ${this.settings.cliTimeoutMs}ms`);
    }
    if (result.termination === 'abort') {
      throw new Error('Obsidian CLI aborted');
    }
    if (result.termination === 'forced-kill') {
      throw new Error(`Obsidian CLI forced-kill after ${result.forcedKillAfter ?? 'timeout'}`);
    }
    if (result.termination === 'signal' || result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim()
        || (result.signal ? `signal ${result.signal}` : `exit ${result.exitCode}`);
      throw new Error(`Obsidian CLI failed: ${detail}`);
    }
    return result.stdout.trim();
  }
}
