import {
  textResult,
  TOOL_OBSIDIAN_TEMPLATES,
  type ToolSpec,
} from '@pivi/agent/tools';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

type TemplatesAction = 'list' | 'read' | 'insert';
const VALID_ACTIONS: readonly TemplatesAction[] = ['list', 'read', 'insert'];

function getTemplatesAction(value: unknown): TemplatesAction | undefined {
  return typeof value === 'string' && (VALID_ACTIONS as readonly string[]).includes(value)
    ? (value as TemplatesAction)
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

export function createTemplatesTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vault, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_TEMPLATES,
    label: 'Templates',
    description:
      'List Obsidian templates, read one, or insert one into the active file. '
      + 'Requires the official Obsidian CLI. Use write with template= to create a new note from a template.',
    promptUsage: {
      summary: 'Inspect or insert Templates core-plugin templates. `list` returns template names. `read` returns template body; `resolve: true` expands {{date}}/{{time}}/{{title}}. `insert` resolves the template through CLI and replaces the active Markdown editor selection through the editor API after a File Recovery snapshot; switching notes or changing content/selection while waiting aborts insertion. Create a new note from a template with `write` `mode=create` `template=`.',
      parameters: '`action` required list|read|insert; `name` required for read/insert; optional `title` and `resolve` for read; optional `total` for list.',
    },
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'read', 'insert'],
          description: 'list: template names. read: template body. insert: insert into the active file.',
        },
        name: { type: 'string', description: 'Template name (required for read/insert).' },
        title: { type: 'string', description: 'Title used when resolving template variables (read).' },
        resolve: { type: 'boolean', description: 'Resolve {{date}}, {{time}}, and {{title}} (read).' },
        total: { type: 'boolean', description: 'List: return a count instead of names.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getTemplatesAction(input['action']);
      if (!action) {
        throw new Error('Invalid templates action: must be list, read, or insert.');
      }

      if (action === 'list') {
        const args = ['templates'];
        if (getBooleanField(input, 'total') === true) {
          args.push('total');
        }
        const out = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(out), { action });
      }

      const name = getStringField(input, 'name')?.trim();
      if (!name) {
        throw new Error('name is required for read and insert.');
      }

      if (action === 'read') {
        const args = ['template:read', `name=${name}`];
        const title = getStringField(input, 'title')?.trim();
        if (title) {
          args.push(`title=${title}`);
        }
        if (getBooleanField(input, 'resolve') === true) {
          args.push('resolve');
        }
        const out = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(out), { action, name });
      }

      const target = vault.prepareActiveNoteInsertion();
      const content = await cli.run({
        vaultName,
        args: ['template:read', `name=${name}`, `title=${target.title}`, 'resolve'],
      });
      await target.insert(content);
      return textResult(`Inserted template ${name} into ${target.path}`, {
        action,
        name,
        path: target.path,
      });
    },
  };
}
