import {
  textResult,
  TOOL_OBSIDIAN_BASE,
  type ToolSpec,
} from '@pivi/agent/tools';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

type BaseAction = 'list' | 'views' | 'query' | 'create';
const VALID_ACTIONS: readonly BaseAction[] = ['list', 'views', 'query', 'create'];
type BaseFormat = 'json' | 'csv' | 'tsv' | 'md' | 'paths';
const VALID_FORMATS: readonly BaseFormat[] = ['json', 'csv', 'tsv', 'md', 'paths'];

function getBaseAction(value: unknown, queryAvailable: boolean): BaseAction | undefined {
  return typeof value === 'string'
    && (VALID_ACTIONS as readonly string[]).includes(value)
    && (queryAvailable || (value !== 'query' && value !== 'create'))
    ? (value as BaseAction)
    : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getBaseFormat(value: unknown): BaseFormat {
  if (value === undefined) {
    return 'json';
  }
  if (typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value)) {
    return value as BaseFormat;
  }
  throw new Error('Invalid base format: must be json, csv, tsv, md, or paths.');
}

export function createBaseTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vault, vaultName } = deps;
  const queryAvailable = deps.obsidianCliAvailable ?? deps.settings.cliEnabled;
  const actionEnum = queryAvailable ? ['list', 'views', 'query', 'create'] : ['list', 'views'];
  return {
    name: TOOL_OBSIDIAN_BASE,
    label: 'Bases',
    description:
      queryAvailable
        ? 'Query Obsidian Bases (built-in databases). List base files, list views in a base, query a base view, or create an item in a base. Query and create require the official Obsidian CLI.'
        : 'Inspect Obsidian Bases (built-in databases). List base files or list views in a base. Query and create are unavailable because Obsidian CLI is not available.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: actionEnum,
          description: queryAvailable
            ? 'list: all base files. views: views in a base. query: query a base view. create: create an item in a base.'
            : 'list: all base files. views: views in a base. Query and create require Obsidian CLI.',
        },
        file: { type: 'string', description: 'Base file name (for views/query/create).' },
        path: { type: 'string', description: 'Base file vault-relative path (for views/query/create).' },
        view: { type: 'string', description: 'View name (for query/create).' },
        format: { type: 'string', enum: ['json', 'csv', 'tsv', 'md', 'paths'], description: 'Output format for query (default json).' },
        name: { type: 'string', description: 'New item name (for create).' },
        content: { type: 'string', description: 'Initial content (for create).' },
        open: { type: 'boolean', description: 'Open the created item (for create).' },
        newtab: { type: 'boolean', description: 'Open the created item in a new tab (for create).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getBaseAction(input['action'], queryAvailable);
      if (!action) {
        throw new Error(queryAvailable
          ? 'Invalid base action: must be list, views, query, or create.'
          : 'Invalid base action: must be list or views. Query and create require Obsidian CLI.');
      }

      if (action === 'list') {
        const bases = vault.getBaseFiles();
        return textResult(JSON.stringify({ bases, total: bases.length }, null, 2), {
          action: 'list',
          total: bases.length,
        });
      }

      const file = getStringField(input, 'file');
      const path = getStringField(input, 'path');
      if (action !== 'create' && !file && !path) {
        throw new Error('file or path is required for views and query actions.');
      }

      if (action === 'views') {
        const result = await vault.getBaseViews(file, path);
        return textResult(JSON.stringify(result, null, 2), {
          action: 'views',
          path: result.path,
          total: result.views.length,
        });
      }

      if (action === 'create') {
        const args = ['base:create'];
        if (file) { args.push(`file=${file}`); }
        if (path) { args.push(`path=${path}`); }
        const view = getStringField(input, 'view');
        const name = getStringField(input, 'name');
        const content = getStringField(input, 'content');
        if (view) { args.push(`view=${view}`); }
        if (name) { args.push(`name=${name}`); }
        if (content) { args.push(`content=${content}`); }
        if (getBooleanField(input, 'open') === true) { args.push('open'); }
        if (getBooleanField(input, 'newtab') === true) { args.push('newtab'); }
        const out = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(out), { action: 'create' });
      }

      const view = getStringField(input, 'view');
      const format = getBaseFormat(input['format']);
      const args = ['base:query', `format=${format}`];
      if (file) { args.push(`file=${file}`); }
      if (path) { args.push(`path=${path}`); }
      if (view) { args.push(`view=${view}`); }
      const out = await cli.run({ vaultName, args });
      return textResult(capCliToolOutput(out), { action: 'query', format });
    },
  };
}
