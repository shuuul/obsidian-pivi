import {
  textResult,
  TOOL_OBSIDIAN_NOTE_INFO,
  type ToolSpec,
} from '@pivi/tools';

import type { ObsidianToolDeps } from './deps';

export function createNoteInfoTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, cli, settings, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_NOTE_INFO,
    label: 'Note info',
    description: 'Note metadata via vault API: path, size, ctime/mtime, tags, outgoing link paths, frontmatter. CLI fallback only if API fails and cliEnabled.',
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
      try {
        const info = vault.getNoteInfo(file, notePath);
        return textResult(JSON.stringify(info, null, 2));
      } catch (apiError) {
        if (!settings.cliEnabled) {
          throw apiError;
        }
        const args = ['file', 'format=json'];
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
