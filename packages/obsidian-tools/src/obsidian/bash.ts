import {
  textResult,
  TOOL_OBSIDIAN_BASH,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { buildEffectiveBashAllowlist } from '../bashAllowlist';
import type { ObsidianToolDeps } from './deps';

const DEFAULT_BASH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const SHELL_CONTROL_PATTERN = /[;&|<>`]|[$][(]|[$][{]/;

function firstShellToken(command: string): string {
  const trimmed = command.trim();
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(trimmed);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function isAllowedCommand(command: string, allowlist: readonly string[]): boolean {
  const token = firstShellToken(command);
  return allowlist.some((entry) => {
    if (entry.includes(' ')) {
      return command === entry || command.startsWith(`${entry} `) || command.startsWith(`${entry}:`);
    }
    return token === entry;
  });
}

function getUserShellPath(): string {
  return process.env.SHELL?.trim() || '/bin/bash';
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated to ${MAX_OUTPUT_CHARS} characters]`;
}

export function createBashTool(deps: ObsidianToolDeps): ToolSpec {
  const { processRunner, settings } = deps;
  const allowlist = buildEffectiveBashAllowlist(settings.bashAllowlist);
  return {
    name: TOOL_OBSIDIAN_BASH,
    label: 'Bash',
    description:
      'Lowest-priority host diagnostic: run one allowlisted single-line shell command only when no registered tool can do the job. '
      + 'Never use Bash to read, search, list, or modify vault files; use Obsidian tools and sub-agents for vault work. '
      + 'Shell control syntax is rejected. After any Bash validation rejection, do not retry Bash during the same turn.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Single-line shell command to run' },
        cwd: { type: 'string', description: 'Optional working directory' },
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

      if (SHELL_CONTROL_PATTERN.test(normalizedCommand)) {
        throw new Error('Bash command must not contain shell control syntax');
      }

      if (allowlist.length === 0 || !isAllowedCommand(normalizedCommand, allowlist)) {
        throw new Error(`Bash command not in allowlist: ${firstShellToken(normalizedCommand) || normalizedCommand}`);
      }

      const shellPath = getUserShellPath();
      const result = await processRunner.run({
        command: shellPath,
        args: ['-lc', normalizedCommand],
        cwd: typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined,
        timeoutMs: settings.cliTimeoutMs || DEFAULT_BASH_TIMEOUT_MS,
      });
      const output = [
        `$ ${normalizedCommand}`,
        result.signal
          ? `signal: ${result.signal}`
          : `exit code: ${result.exitCode ?? 'unknown'}`,
        result.stdout ? `\nstdout:\n${result.stdout.trimEnd()}` : '',
        result.stderr ? `\nstderr:\n${result.stderr.trimEnd()}` : '',
        result.stdoutTruncated ? '\n[stdout truncated]' : '',
        result.stderrTruncated ? '\n[stderr truncated]' : '',
      ].filter(Boolean).join('\n');
      return textResult(truncateOutput(output));
    },
  };
}
