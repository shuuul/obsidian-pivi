import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_SEARCH } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import type { ObsidianToolDeps } from './deps';

export function createSearchTool(deps: ObsidianToolDeps): AgentTool {
  const { vault, cli, settings, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_SEARCH,
    label: 'Search vault',
    description: 'Search note contents (substring match) or list files in a folder. Use query="*" or query="path:folder" with optional path= to list markdown files; not Obsidian search syntax. Falls back to CLI on API errors.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Plain text substring, tag:name, path:folder, or * / path:folder to list .md files in scope',
        },
        path: { type: 'string', description: 'Optional folder prefix (combines with query path:)' },
        limit: { type: 'number' },
        context: { type: 'boolean', description: 'Include ±2 context lines per match (API). CLI fallback uses search:context.' },
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

      try {
        const hits = await vault.searchNotes({
          query,
          path: folder,
          limit,
          context,
        });
        const payload = format === 'text'
          ? hits.map((h) => {
            const loc = h.line ? `${h.path}:${h.line}` : h.path;
            const ctx = h.matches?.length ? `\n${h.matches.join('\n')}` : '';
            return `${loc}${ctx}`;
          }).join('\n---\n')
          : JSON.stringify(hits, null, 2);
        return textResult(payload);
      } catch (apiError) {
        if (!settings.cliEnabled) {
          throw apiError;
        }
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
      }
    },
  };
}
