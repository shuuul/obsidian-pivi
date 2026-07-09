import {
  textResult,
  TOOL_OBSIDIAN_BASE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type BaseAction = 'list' | 'views' | 'query';
const VALID_ACTIONS: readonly BaseAction[] = ['list', 'views', 'query'];
type BaseFormat = 'json' | 'csv' | 'tsv' | 'md' | 'paths';
const VALID_FORMATS: readonly BaseFormat[] = ['json', 'csv', 'tsv', 'md', 'paths'];

function getBaseAction(value: unknown, queryAvailable: boolean): BaseAction | undefined {
  return typeof value === 'string'
    && (VALID_ACTIONS as readonly string[]).includes(value)
    && (queryAvailable || value !== 'query')
    ? (value as BaseAction)
    : undefined;
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
  const actionEnum = queryAvailable ? ['list', 'views', 'query'] : ['list', 'views'];
  return {
    name: TOOL_OBSIDIAN_BASE,
    label: 'Bases',
    description:
      queryAvailable
        ? 'Query Obsidian Bases (built-in databases). List base files, list views in a base, or query a base view and return results. Query action requires the official Obsidian CLI.'
        : 'Inspect Obsidian Bases (built-in databases). List base files or list views in a base. Query action is unavailable because Obsidian CLI is not available.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: actionEnum,
          description: queryAvailable
            ? 'list: all base files. views: views in a base. query: query a base view.'
            : 'list: all base files. views: views in a base. Query is unavailable because Obsidian CLI is not available.',
        },
        file: { type: 'string', description: 'Base file name (for views/query).' },
        path: { type: 'string', description: 'Base file vault-relative path (for views/query).' },
        view: { type: 'string', description: 'View name (for query).' },
        format: { type: 'string', enum: ['json', 'csv', 'tsv', 'md', 'paths'], description: 'Output format for query (default json).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getBaseAction(input['action'], queryAvailable);
      if (!action) {
        throw new Error(queryAvailable
          ? 'Invalid base action: must be list, views, or query.'
          : 'Invalid base action: must be list or views. Query requires Obsidian CLI.');
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
      if (!file && !path) {
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

      // query
      const view = getStringField(input, 'view');
      const format = getBaseFormat(input['format']);
      const args = ['base:query', `format=${format}`];
      if (file) { args.push(`file=${file}`); }
      if (path) { args.push(`path=${path}`); }
      if (view) { args.push(`view=${view}`); }
      const out = await cli.run({ vaultName, args });
      return textResult(out, { action: 'query', format });
    },
  };
}
