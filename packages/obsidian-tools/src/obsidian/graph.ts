import {
  textResult,
  TOOL_OBSIDIAN_GRAPH,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type GraphAction = 'orphans' | 'deadends' | 'unresolved';
const VALID_ACTIONS: readonly GraphAction[] = ['orphans', 'deadends', 'unresolved'];

function parseGraphAction(value: string): GraphAction {
  if ((VALID_ACTIONS as readonly string[]).includes(value)) {
    return value as GraphAction;
  }
  throw new Error('Invalid graph action: must be orphans, deadends, or unresolved.');
}

function getGraphActions(value: unknown): GraphAction[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts.map(parseGraphAction) : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item !== 'string') {
        throw new Error('Invalid graph action: actions must be strings.');
      }
      return parseGraphAction(item);
    });
  }
  throw new Error('Invalid graph actions: expected a comma-separated string or string array.');
}

function getPositiveIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) { return undefined; }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function createGraphTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_GRAPH,
    label: 'Graph analysis',
    description:
      'Analyze vault graph: orphans (notes with no backlinks), deadends (notes with no outgoing links), '
      + 'and unresolved (broken wikilinks pointing to non-existent notes). '
      + 'Uses in-process MetadataCache; no CLI required.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'string',
          description: 'Comma-separated list: orphans,deadends,unresolved. Default: orphans.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results per action (default 200).',
        },
        includeNonMarkdown: {
          type: 'boolean',
          description: 'Include non-markdown files in orphans/deadends (default false).',
        },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const requested = getGraphActions(input['actions']);
      const actions = requested ?? (['orphans'] as GraphAction[]);
      const limit = getPositiveIntegerField(input, 'limit') ?? 200;
      const includeNonMarkdown = getBooleanField(input, 'includeNonMarkdown') ?? false;

      const result = vault.getGraphAnalysis(actions, { includeNonMarkdown, limit });
      const body = JSON.stringify(result, null, 2);
      return textResult(body, {
        actions: actions.join(','),
        orphans: result.orphans.length,
        deadends: result.deadends.length,
        unresolved: result.unresolved.length,
      });
    },
  };
}
