import {
  textResult,
  TOOL_OBSIDIAN_TAGS,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type TagsAction = 'list' | 'info';
const VALID_ACTIONS: readonly TagsAction[] = ['list', 'info'];

function getTagsAction(value: unknown): TagsAction | undefined {
  return typeof value === 'string' && (VALID_ACTIONS as readonly string[]).includes(value)
    ? (value as TagsAction)
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

function getSortField(value: unknown): 'name' | 'count' {
  if (value === undefined || value === 'name') {
    return 'name';
  }
  if (value === 'count') {
    return 'count';
  }
  throw new Error('Invalid tags sort: must be name or count.');
}

export function createTagsTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_TAGS,
    label: 'Tags',
    description:
      'List all tags in the vault with occurrence counts, or get details for a single tag. '
      + 'Uses in-process MetadataCache; no CLI required.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'info'],
          description: 'list: vault-wide tag index. info: details for one tag.',
        },
        name: {
          type: 'string',
          description: 'Tag name (required for info action; with or without # prefix).',
        },
        sort: {
          type: 'string',
          enum: ['name', 'count'],
          description: 'Sort order for list action (default: name).',
        },
        verbose: {
          type: 'boolean',
          description: 'For info: include file paths containing the tag.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getTagsAction(input['action']);
      if (!action) {
        throw new Error('Invalid tags action: must be list or info.');
      }

      if (action === 'list') {
        const sort = getSortField(input['sort']);
        const tags = vault.getTags(sort);
        return textResult(JSON.stringify({ tags, total: tags.length }, null, 2), {
          action: 'list',
          total: tags.length,
        });
      }

      const name = getStringField(input, 'name');
      if (!name) {
        throw new Error('name is required for info action.');
      }
      const verbose = getBooleanField(input, 'verbose') ?? false;
      const info = vault.getTagInfo(name, verbose);
      return textResult(JSON.stringify(info, null, 2), { action: 'info', name: info.name });
    },
  };
}
