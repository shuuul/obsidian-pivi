import {
  textResult,
  TOOL_OBSIDIAN_DAILY,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type DailyAction = 'read' | 'append' | 'prepend' | 'path';
const VALID_ACTIONS: readonly DailyAction[] = ['read', 'append', 'prepend', 'path'];

function getDailyAction(value: unknown): DailyAction | undefined {
  return typeof value === 'string' && (VALID_ACTIONS as readonly string[]).includes(value)
    ? (value as DailyAction)
    : undefined;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function createDailyTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_DAILY,
    label: 'Daily note',
    description:
      'Read from, append to, or prepend to the daily note. '
      + 'Also resolve the daily note path. '
      + 'Requires the official Obsidian CLI and that the daily-notes core plugin is enabled.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'append', 'prepend', 'path'],
          description: 'Daily note action.',
        },
        content: {
          type: 'string',
          description: 'Content to append or prepend (required for append/prepend).',
        },
        inline: {
          type: 'boolean',
          description: 'Append/prepend without newline separator.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getDailyAction(input['action']);
      if (!action) {
        throw new Error('Invalid daily action: must be read, append, prepend, or path.');
      }
      const content = getStringField(input, 'content');
      const inline = getBooleanField(input, 'inline') ?? false;

      if (action === 'path') {
        const out = await cli.run({ vaultName, args: ['daily:path'] });
        return textResult(out);
      }

      if ((action === 'append' || action === 'prepend') && !content) {
        throw new Error(`content is required for ${action}.`);
      }

      const subcommand = action === 'read' ? 'daily:read' : action === 'append' ? 'daily:append' : 'daily:prepend';
      const args = [subcommand];
      if (content) {
        args.push(`content=${content}`);
      }
      if (inline) {
        args.push('inline');
      }
      const out = await cli.run({ vaultName, args });
      return textResult(out, { action });
    },
  };
}
