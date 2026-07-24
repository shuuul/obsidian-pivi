import { getVaultPath } from '@pivi/obsidian-host/path';
import {
  textResult,
  TOOL_OBSIDIAN_BASH,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import {
  buildEffectiveBashAllowlist,
  matchBashCommandAllowlist,
} from '../bashAllowlist';
import { ensureBashCommandAllowed } from '../capabilityApprovalGate';
import { buildLoginShellInvocation } from '../loginShell';
import type { ObsidianToolDeps } from './deps';

const DEFAULT_BASH_TIMEOUT_MS = 30_000;
const DEFAULT_BASH_OUTPUT_BYTE_LIMIT = 256 * 1024;
const MAX_OUTPUT_CHARS = 20_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated to ${MAX_OUTPUT_CHARS} characters]`;
}

export function createBashTool(deps: ObsidianToolDeps): ToolSpec {
  const { processRunner, settings, app } = deps;
  return {
    name: TOOL_OBSIDIAN_BASH,
    label: 'Bash',
    description:
      'Lowest-priority host diagnostic: run a single-line shell command through the user login shell when no registered tool can do the job. '
      + 'Prefer pre-approved allowlist commands; when the user explicitly requests a specific command, call this tool even if it is not allowlisted—Pivi shows a sidebar approval prompt first. '
      + 'Never use Bash to read, search, list, or modify vault files; use Obsidian tools and sub-agents for vault work. '
      + 'After the user denies or validation rejects a command, do not retry Bash during the same turn.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Single-line shell command (may include pipes and other shell syntax when allowlisted)',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory inside the vault',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const { command, cwd } = params as { command: string; cwd?: string };
      const normalizedCommand = command.trim();
      if (!normalizedCommand) {
        throw new Error('Bash command is required');
      }
      if (/\r|\n/.test(normalizedCommand)) {
        throw new Error('Bash command must be a single line');
      }

      const effectiveAllowlist = buildEffectiveBashAllowlist(settings.bashAllowlist);
      if (!matchBashCommandAllowlist(normalizedCommand, effectiveAllowlist)) {
        await ensureBashCommandAllowed(deps, normalizedCommand, false);
      }

      const vaultRoot = getVaultPath(app);
      if (!vaultRoot) {
        throw new Error('Vault path is unavailable for Bash cwd containment');
      }

      const { executable, args } = buildLoginShellInvocation(normalizedCommand);
      const timeoutMs = settings.cliTimeoutMs || DEFAULT_BASH_TIMEOUT_MS;
      const result = await processRunner.run({
        executable,
        args: [...args],
        cwdPolicy: { mode: 'vault', vaultRoot },
        ...(typeof cwd === 'string' && cwd.trim() ? { cwd: cwd.trim() } : {}),
        timeoutMs,
        stdoutByteLimit: DEFAULT_BASH_OUTPUT_BYTE_LIMIT,
        stderrByteLimit: DEFAULT_BASH_OUTPUT_BYTE_LIMIT,
        shell: { mode: 'forbidden' },
      });

      if (result.termination === 'spawn-error') {
        throw new Error(result.spawnError ?? 'Bash process failed to start');
      }

      const statusLine = (() => {
        switch (result.termination) {
          case 'exit':
            return `exit code: ${result.exitCode ?? 'unknown'}`;
          case 'signal':
            return `signal: ${result.signal ?? 'unknown'}`;
          case 'timeout':
            return 'terminated: timeout';
          case 'abort':
            return 'terminated: abort';
          case 'forced-kill':
            return `terminated: forced-kill after ${result.forcedKillAfter ?? 'unknown'}`;
          default: {
            const termination: string = result.termination;
            return `terminated: ${termination}`;
          }
        }
      })();

      const output = [
        `$ ${normalizedCommand}`,
        statusLine,
        result.stdout ? `\nstdout:\n${result.stdout.trimEnd()}` : '',
        result.stderr ? `\nstderr:\n${result.stderr.trimEnd()}` : '',
        result.stdoutTruncated ? '\n[stdout truncated]' : '',
        result.stderrTruncated ? '\n[stderr truncated]' : '',
      ].filter(Boolean).join('\n');
      return textResult(truncateOutput(output));
    },
  };
}
