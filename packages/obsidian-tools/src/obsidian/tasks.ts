import {
  textResult,
  TOOL_OBSIDIAN_TASKS,
  type ToolSpec,
} from '@pivi/agent/tools';
import { requireAgentVaultMutationPath } from '@pivi/obsidian-host/path';

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
  const { cli, vault, vaultName, vaultPath } = deps;
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

      let targetFile: string | undefined;
      let targetPath: string | undefined = notePath;
      let targetLine = line;
      if (ref) {
        const match = /^(.*):(\d+)$/.exec(ref.trim());
        if (!match?.[1]) {
          throw new Error('Task ref could not be resolved to an exact Vault path.');
        }
        targetPath = match[1];
        targetLine = Number(match[2]);
      } else if (file) {
        targetFile = file;
      } else if (input.daily) {
        const dailyPath = (await cli.run({ vaultName, args: ['daily:path'] })).trim();
        targetPath = dailyPath || undefined;
      }
      const resolved = vault.resolveFile(targetFile, targetPath);
      if (!resolved) {
        throw new Error('Task mutation target could not be resolved to an exact Vault path.');
      }
      requireAgentVaultMutationPath(resolved.path, vaultPath);

      const args = ['task', `path=${JSON.stringify(resolved.path)}`];
      if (targetLine !== undefined) {
        args.push(`line=${targetLine}`);
      }
      if (action === 'toggle') {
        args.push('toggle');
      } else if (action === 'done') {
        args.push('done');
      } else if (action === 'todo') {
        args.push('todo');
      }
      return textResult(await cli.run({ vaultName, args }));
    },
  };
}
