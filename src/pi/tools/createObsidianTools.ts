import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { App } from 'obsidian';

import { getActionDescription } from '../../core/security/ApprovalManager';
import { isObsidianMutatingTool } from '../../core/tools/obsidianToolNames';
import {
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../../core/tools/obsidianToolNames';
import type { ApprovalDecision } from '../../core/types/settings';
import type { ObsidianToolsSettings } from '../../core/types/settings';
import { ObsidianCliTransport } from './ObsidianCliTransport';
import { ObsidianVaultApi } from './ObsidianVaultApi';

export type ObsidianApprovalFn = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
) => Promise<ApprovalDecision>;

function textResult(text: string, details: Record<string, unknown> = {}): {
  content: [{ type: 'text'; text: string }];
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

async function requireApproval(
  approve: ObsidianApprovalFn | null,
  toolName: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!approve || !isObsidianMutatingTool(toolName)) {
    return;
  }
  const description = getActionDescription(toolName, input);
  const decision = await approve(toolName, input, description);
  if (decision === 'deny' || decision === 'cancel') {
    throw new Error(`User denied: ${toolName}`);
  }
}

export function createObsidianTools(
  app: App,
  settings: ObsidianToolsSettings,
  approve: ObsidianApprovalFn | null,
): AgentTool[] {
  const vault = new ObsidianVaultApi(app);
  const cli = new ObsidianCliTransport(settings);
  const vaultName = vault.getVaultName();

  const tools: AgentTool[] = [
    {
      name: TOOL_OBSIDIAN_READ,
      label: 'Read note',
      description: 'Read a vault note by wikilink file name or vault-relative path.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Note name (wikilink resolution)' },
          path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { file, path: notePath } = params as { file?: string; path?: string };
        const result = await vault.readNote(file, notePath);
        return textResult(result.content, { path: result.path });
      },
    },
    {
      name: TOOL_OBSIDIAN_WRITE,
      label: 'Write note',
      description: 'Create, overwrite, append, or prepend note content in the vault.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string', description: 'Content to write' },
          mode: {
            type: 'string',
            enum: ['create', 'overwrite', 'append', 'prepend'],
            description: 'Write mode',
          },
          overwrite: { type: 'boolean', description: 'Allow overwrite when mode=create' },
        },
        required: ['content', 'mode'],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const input = params as Record<string, unknown>;
        await requireApproval(approve, TOOL_OBSIDIAN_WRITE, input);
        const result = await vault.writeNote({
          file: input.file as string | undefined,
          path: input.path as string | undefined,
          content: String(input.content ?? ''),
          mode: input.mode as 'create' | 'overwrite' | 'append' | 'prepend',
          overwrite: Boolean(input.overwrite),
        });
        return textResult(`Wrote ${result.path}`, result);
      },
    },
    {
      name: TOOL_OBSIDIAN_SEARCH,
      label: 'Search vault',
      description: 'Full-text search via Obsidian CLI. Use context=true for grep-style context lines.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', description: 'Limit to folder' },
          limit: { type: 'number' },
          context: { type: 'boolean', description: 'Use search:context' },
          format: { type: 'string', enum: ['text', 'json'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { query, path: folder, limit, context, format } = params as {
          query: string;
          path?: string;
          limit?: number;
          context?: boolean;
          format?: string;
        };
        const sub = context ? 'search:context' : 'search';
        const args = [`${sub}`, `query=${JSON.stringify(query)}`, 'format=json'];
        if (folder) {
          args.push(`path=${JSON.stringify(folder)}`);
        }
        if (limit !== undefined) {
          args.push(`limit=${limit}`);
        }
        if (format === 'text') {
          args[args.length - 1] = 'format=text';
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      },
    },
    {
      name: TOOL_OBSIDIAN_NOTE_INFO,
      label: 'Note info',
      description: 'Get file metadata via Obsidian CLI.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          path: { type: 'string' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { file, path: notePath } = params as { file?: string; path?: string };
        const args = ['file', 'format=json'];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      },
    },
    {
      name: TOOL_OBSIDIAN_LINKS,
      label: 'Links',
      description: 'List outgoing links or backlinks for a note.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          path: { type: 'string' },
          direction: { type: 'string', enum: ['outgoing', 'backlinks'] },
          format: { type: 'string', enum: ['json', 'tsv', 'csv'] },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { file, path: notePath, direction, format } = params as {
          file?: string;
          path?: string;
          direction?: string;
          format?: string;
        };
        const sub = direction === 'backlinks' ? 'backlinks' : 'links';
        const args = [sub, `format=${format ?? 'json'}`];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      },
    },
    {
      name: TOOL_OBSIDIAN_PROPERTIES,
      label: 'Properties',
      description: 'Read or set frontmatter properties on a note.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'set', 'remove'] },
          name: { type: 'string' },
          value: { type: 'string' },
          file: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const input = params as Record<string, unknown>;
        await requireApproval(approve, TOOL_OBSIDIAN_PROPERTIES, input);
        const action = String(input.action);
        const file = input.file as string | undefined;
        const notePath = input.path as string | undefined;
        const propName = input.name as string | undefined;

        if (action === 'list') {
          const args = ['properties', 'format=json'];
          if (file) {
            args.push(`file=${file}`);
          }
          if (notePath) {
            args.push(`path=${JSON.stringify(notePath)}`);
          }
          return textResult(await cli.run({ vaultName, args }));
        }
        if (action === 'read' && propName) {
          const args = ['property:read', `name=${propName}`, 'format=json'];
          if (file) {
            args.push(`file=${file}`);
          }
          if (notePath) {
            args.push(`path=${JSON.stringify(notePath)}`);
          }
          return textResult(await cli.run({ vaultName, args }));
        }
        if (action === 'set' && propName) {
          const args = [
            'property:set',
            `name=${propName}`,
            `value=${JSON.stringify(String(input.value ?? ''))}`,
          ];
          if (file) {
            args.push(`file=${file}`);
          }
          if (notePath) {
            args.push(`path=${JSON.stringify(notePath)}`);
          }
          return textResult(await cli.run({ vaultName, args }));
        }
        if (action === 'remove' && propName) {
          const args = ['property:remove', `name=${propName}`];
          if (file) {
            args.push(`file=${file}`);
          }
          if (notePath) {
            args.push(`path=${JSON.stringify(notePath)}`);
          }
          return textResult(await cli.run({ vaultName, args }));
        }
        throw new Error('Invalid properties action or missing name.');
      },
    },
    {
      name: TOOL_OBSIDIAN_TASKS,
      label: 'Tasks',
      description: 'List or update markdown tasks via Obsidian CLI.',
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
    },
  ];

  if (settings.allowCommand) {
    tools.push({
      name: TOOL_OBSIDIAN_COMMAND,
      label: 'Obsidian command',
      description: 'Execute an Obsidian palette command by id. Restricted by allowlist when configured.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Command id' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { id } = params as { id: string };
        const allowlist = settings.commandAllowlist;
        if (allowlist.length > 0 && !allowlist.includes(id)) {
          throw new Error(`Command not in allowlist: ${id}`);
        }
        const input = { id };
        await requireApproval(approve, TOOL_OBSIDIAN_COMMAND, input);
        const out = await cli.run({ vaultName, args: ['command', `id=${id}`] });
        return textResult(out || `Executed command ${id}`);
      },
    });
  }

  if (settings.allowEval) {
    tools.push({
      name: TOOL_OBSIDIAN_EVAL,
      label: 'Obsidian eval',
      description: 'Execute JavaScript in Obsidian via CLI eval. High privilege — use only when necessary.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
        required: ['code'],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { code } = params as { code: string };
        const input = { code };
        await requireApproval(approve, TOOL_OBSIDIAN_EVAL, input);
        const out = await cli.run({
          vaultName,
          args: ['eval', `code=${JSON.stringify(code)}`],
        });
        return textResult(out);
      },
    });
  }

  return tools;
}
