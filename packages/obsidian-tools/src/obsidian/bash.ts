import {
  textResult,
  TOOL_OBSIDIAN_BASH,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

const DEFAULT_BASH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_SAFE_BASH_ALLOWLIST = ['which', 'type', 'command', 'pwd'] as const;

function normalizeAllowlist(value: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value ?? []) {
    const command = entry.trim();
    if (!command || seen.has(command)) {
      continue;
    }
    seen.add(command);
    normalized.push(command);
  }
  return normalized;
}

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
  return {
    name: TOOL_OBSIDIAN_BASH,
    label: 'Bash',
    description: 'Run one allowlisted shell command. The command must be a single line and match the Bash allowlist configured by the user.',
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

      const allowlist = normalizeAllowlist([...DEFAULT_SAFE_BASH_ALLOWLIST, ...(settings.bashAllowlist ?? [])]);
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
        `exit code: ${result.exitCode}`,
        result.stdout ? `\nstdout:\n${result.stdout.trimEnd()}` : '',
        result.stderr ? `\nstderr:\n${result.stderr.trimEnd()}` : '',
      ].filter(Boolean).join('\n');
      return textResult(truncateOutput(output));
    },
  };
}
