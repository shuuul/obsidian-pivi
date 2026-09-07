import {
  textResult,
  TOOL_OBSIDIAN_COMMAND,
  type ToolSpec,
} from '@pivi/agent/tools';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

type CommandAction = 'execute' | 'list' | 'hotkey' | 'hotkeys';

function getCommandAction(value: unknown): CommandAction {
  if (value === undefined) {
    return 'execute';
  }
  if (value === 'execute' || value === 'list' || value === 'hotkey' || value === 'hotkeys') {
    return value;
  }
  throw new Error('Invalid command action: must be execute, list, hotkey, or hotkeys.');
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function createCommandTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, settings, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_COMMAND,
    label: 'Obsidian command',
    description: 'Discover Obsidian commands and hotkeys, or execute a palette command by id. Execution is restricted by the allowlist when configured.',
    promptUsage: {
      summary: 'Discover command IDs with `list`, inspect one binding with `hotkey`, list bindings with `hotkeys`, then use `execute` only when a UI command is required. Omitted `action` remains execute for compatibility.',
      parameters: '`action?` execute|list|hotkey|hotkeys; `id` required for execute/hotkey; `filter` for list; `verbose` for hotkey/hotkeys; `total` and `all` for hotkeys.',
    },
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['execute', 'list', 'hotkey', 'hotkeys'] },
        id: { type: 'string', description: 'Command id for execute or hotkey.' },
        filter: { type: 'string', description: 'List: command-id prefix.' },
        verbose: { type: 'boolean', description: 'Hotkey/hotkeys: include whether bindings are custom or default.' },
        total: { type: 'boolean', description: 'Hotkeys: return only the binding count.' },
        all: { type: 'boolean', description: 'Hotkeys: include commands without bindings.' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getCommandAction(input.action);
      const id = getStringField(input, 'id');

      if (action === 'list') {
        const args = ['commands'];
        const filter = getStringField(input, 'filter');
        if (filter) {
          args.push(`filter=${filter}`);
        }
        return textResult(capCliToolOutput(await cli.run({ vaultName, args })), { action, filter });
      }

      if (action === 'hotkeys') {
        const args = ['hotkeys', 'format=json'];
        if (input.verbose === true) { args.push('verbose'); }
        if (input.total === true) { args.push('total'); }
        if (input.all === true) { args.push('all'); }
        return textResult(capCliToolOutput(await cli.run({ vaultName, args })), { action });
      }

      if (!id) {
        throw new Error(`id is required for ${action}.`);
      }
      if (action === 'hotkey') {
        const args = ['hotkey', `id=${id}`];
        if (input.verbose === true) { args.push('verbose'); }
        return textResult(capCliToolOutput(await cli.run({ vaultName, args })), { action, id });
      }

      const allowlist = settings.commandAllowlist;
      if (allowlist.length > 0 && !allowlist.includes(id)) {
        throw new Error(`Command not in allowlist: ${id}`);
      }
      const out = await cli.run({ vaultName, args: ['command', `id=${id}`] });
      return textResult(capCliToolOutput(out || `Executed command ${id}`), { action, id });
    },
  };
}
