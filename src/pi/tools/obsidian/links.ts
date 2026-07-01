import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_LINKS } from '../../../pi/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import type { ObsidianToolDeps } from './deps';

export function createLinksTool(deps: ObsidianToolDeps): AgentTool {
  const { vault, cli, settings, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_LINKS,
    label: 'Links',
    description: 'Outgoing links or backlinks for one note (MetadataCache, JSON). CLI fallback (tsv/csv) only if API fails and cliEnabled.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Wikilink-style note name' },
        path: { type: 'string', description: 'Vault-relative path' },
        direction: { type: 'string', enum: ['outgoing', 'backlinks'] },
        format: { type: 'string', enum: ['json', 'tsv', 'csv'], description: 'CLI fallback only; API path always returns JSON' },
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
      const dir = direction === 'backlinks' ? 'backlinks' : 'outgoing';
      try {
        const result = vault.getLinks(file, notePath, dir);
        return textResult(JSON.stringify(result, null, 2));
      } catch (apiError) {
        if (!settings.cliEnabled) {
          throw apiError;
        }
        const sub = dir === 'backlinks' ? 'backlinks' : 'links';
        const args = [sub, `format=${format ?? 'json'}`];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      }
    },
  };
}
