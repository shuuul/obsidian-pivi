import {
  textResult,
  TOOL_OBSIDIAN_WRITE,
  type ToolSpec,
} from '@pivi/agent/tools';
import { requireAgentVaultMutationPath } from '@pivi/obsidian-host/path';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

const MAX_WRITE_CONTENT_CHARS = 50_000;

type WriteNoteMode = 'create' | 'overwrite' | 'append' | 'prepend';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getWriteMode(value: unknown): WriteNoteMode | undefined {
  return value === 'create' || value === 'overwrite' || value === 'append' || value === 'prepend'
    ? value
    : undefined;
}

export function createWriteNoteTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, cli, vaultName, vaultPath } = deps;
  const cliAvailable = deps.obsidianCliAvailable ?? deps.settings.cliEnabled;
  return {
    name: TOOL_OBSIDIAN_WRITE,
    label: 'Write note',
    description: 'Create, overwrite, append, or prepend note content via vault API. path= or file= required for create/overwrite. mode defaults to overwrite. template= uses the official CLI create command.',
    promptUsage: {
      summary: 'Write note content. Omit `mode` to overwrite. Keep `append`/`prepend`/`create`. `create` still needs `overwrite: true` to clobber an existing file. `content` is capped at 50,000 characters; use `edit` or smaller appends for larger notes. `template` creates from an Obsidian template and requires CLI. `inline` concatenates append/prepend without a newline. `prepend` inserts after YAML frontmatter.',
      parameters: '`path` or `file`, `content` (max 50,000 characters; optional when `template` is set), optional `mode` (overwrite|append|prepend|create, default overwrite), optional `overwrite` for create, optional `inline` for append/prepend, optional `template` for create.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string', description: 'Content to write (max 50,000 characters)' },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append', 'prepend'],
          description: 'Write mode; omit to overwrite',
        },
        overwrite: { type: 'boolean', description: 'Allow overwrite when mode=create' },
        inline: { type: 'boolean', description: 'Append/prepend without a newline separator' },
        template: { type: 'string', description: 'Template name for create (requires official Obsidian CLI)' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const content = getStringField(input, 'content');
      const template = getStringField(input, 'template')?.trim();
      const mode = getWriteMode(input.mode) ?? (template ? 'create' : 'overwrite');
      const inline = getBooleanField(input, 'inline') === true;
      const file = getStringField(input, 'file');
      const path = getStringField(input, 'path');

      if (template) {
        if (!cliAvailable) {
          throw new Error('template requires Obsidian CLI.');
        }
        if (mode !== 'create') {
          throw new Error('template is only valid with mode=create.');
        }
        if (!path && !file) {
          throw new Error('path= or file= required for create/overwrite.');
        }
        if (content !== undefined && content.length > MAX_WRITE_CONTENT_CHARS) {
          throw new Error(
            `Invalid write input: content exceeds ${MAX_WRITE_CONTENT_CHARS} characters. Use edit or smaller appends.`,
          );
        }
        const requestedPath = path?.trim() || (file?.endsWith('.md') ? file : `${file}.md`);
        const mutationPath = requireAgentVaultMutationPath(requestedPath, vaultPath);
        const args = ['create', `template=${template}`, `path=${mutationPath}`];
        if (content !== undefined) {
          args.push(`content=${content}`);
        }
        if (input.overwrite === true) {
          args.push('overwrite');
        }
        const runCreate = () => cli.run({ vaultName, args });
        const output = input.overwrite === true
          ? await vault.runCliMutation(mutationPath, runCreate)
          : await runCreate();
        return textResult(
          capCliToolOutput(output.trim() || `Created from template ${template}`),
          { path: mutationPath, file, template },
        );
      }

      if (content === undefined) {
        throw new Error('Invalid write input: content is required.');
      }
      if (content.length > MAX_WRITE_CONTENT_CHARS) {
        throw new Error(
          `Invalid write input: content exceeds ${MAX_WRITE_CONTENT_CHARS} characters. Use edit or smaller appends.`,
        );
      }
      const result = await vault.writeNote({
        file,
        path,
        content,
        mode,
        overwrite: Boolean(input.overwrite),
        inline,
      });
      return textResult(`Wrote ${result.path}`, result);
    },
  };
}
