import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_TASKS } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

export function createTasksTool(deps: ObsidianToolDeps): AgentTool {
  const { cli, vaultName, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_TASKS,
    label: 'Tasks',
    description: 'List or update markdown checkbox tasks via Obsidian CLI only (requires cliEnabled).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'toggle', 'done', 'todo'] },
        file: { type: 'string' },
        path: { type: 'string' },
        line: { type: 'number' },
        ref: { type: 'string', description: 'path:line reference' },
        daily: { type: 'boolean' },
        todo: { type: 'boolean' },
        done: { type: 'boolean' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      await requireApproval(approve, TOOL_OBSIDIAN_TASKS, input);
      const action = String(input.action);
      if (action === 'list') {
        const args = ['tasks', 'format=json'];
        if (input.file) {
          args.push(`file=${input.file}`);
        }
        if (input.path) {
          args.push(`path=${JSON.stringify(input.path)}`);
        }
        if (input.todo) {
          args.push('todo');
        }
        if (input.done) {
          args.push('done');
        }
        if (input.daily) {
          args.push('daily');
        }
        return textResult(await cli.run({ vaultName, args }));
      }
      const args = ['task'];
      if (input.ref) {
        args.push(`ref=${JSON.stringify(input.ref)}`);
      }
      if (input.file) {
        args.push(`file=${input.file}`);
      }
      if (input.path) {
        args.push(`path=${JSON.stringify(input.path)}`);
      }
      if (input.line !== undefined) {
        args.push(`line=${input.line}`);
      }
      if (action === 'toggle') {
        args.push('toggle');
      } else if (action === 'done') {
        args.push('done');
      } else if (action === 'todo') {
        args.push('todo');
      }
      if (input.daily) {
        args.push('daily');
      }
      return textResult(await cli.run({ vaultName, args }));
    },
  };
}
