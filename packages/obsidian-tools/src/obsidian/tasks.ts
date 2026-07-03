import {
  textResult,
  TOOL_OBSIDIAN_TASKS,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

type TasksAction = 'list' | 'toggle' | 'done' | 'todo';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getTasksAction(value: unknown): TasksAction | undefined {
  return value === 'list' || value === 'toggle' || value === 'done' || value === 'todo'
    ? value
    : undefined;
}

export function createTasksTool(deps: ObsidianToolDeps): ToolSpec {
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
      const action = getTasksAction(input.action);
      if (!action) {
        throw new Error('Invalid tasks action.');
      }
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      const ref = getStringField(input, 'ref');
      const line = getNumberField(input, 'line');
      if (action === 'list') {
        const args = ['tasks', 'format=json'];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
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
      if (ref) {
        args.push(`ref=${JSON.stringify(ref)}`);
      }
      if (file) {
        args.push(`file=${file}`);
      }
      if (notePath) {
        args.push(`path=${JSON.stringify(notePath)}`);
      }
      if (line !== undefined) {
        args.push(`line=${line}`);
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
