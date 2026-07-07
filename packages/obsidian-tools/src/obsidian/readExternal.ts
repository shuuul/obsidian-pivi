import {
  textResult,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';
import {
  buildStatsText,
  DEFAULT_SAFE_READ_MAX_CHARS,
  getLineSpans,
  getPositiveIntegerField,
  getReadMode,
  getStats,
  getStringField,
  sliceLineRange,
} from './readShared';

const MAX_EXTERNAL_READ_BYTES = 10_000_000;

function buildExternalByteStatsText(params: {
  path: string;
  bytes: number;
  maxChars: number;
  hardLimitBytes: number;
}): string {
  return [
    `Path: ${params.path}`,
    `Bytes: ${params.bytes}`,
    '',
    `Large external file: content was not returned because it exceeds ${params.maxChars} characters/bytes.`,
    'Use obsidian_read_external with startLine/endLine for smaller files, or inspect the file with a more specialized external tool.',
    `External reads have a hard safety limit of ${params.hardLimitBytes} bytes.`,
  ].join('\n');
}

export function createReadExternalTool(deps: ObsidianToolDeps): ToolSpec {
  const { externalFiles } = deps;
  return {
    name: TOOL_OBSIDIAN_READ_EXTERNAL,
    label: 'Read external file',
    description: 'Read an external file by absolute path. Defaults to stats-only for large files; deliberately raise maxChars to read the full file when needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path, e.g. /Users/me/Workspace/file.ts' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads (default 20000). To read a full large file, first use mode=stats, then set maxChars to at least the reported Characters value deliberately.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const absolutePath = getStringField(input, 'path');
      if (!absolutePath) {
        throw new Error('Invalid read external input: path must be an absolute string.');
      }
      const mode = getReadMode(input);
      const startLine = getPositiveIntegerField(input, 'startLine');
      const endLine = getPositiveIntegerField(input, 'endLine');
      const maxChars = getPositiveIntegerField(input, 'maxChars') ?? DEFAULT_SAFE_READ_MAX_CHARS;
      const fileStat = externalFiles.stat(absolutePath);
      const isRangeRead = startLine !== undefined || endLine !== undefined;
      if (fileStat.size > MAX_EXTERNAL_READ_BYTES && (isRangeRead || maxChars >= fileStat.size)) {
        throw new Error(
          `External file is ${fileStat.size} bytes, which exceeds the hard safety limit of ${MAX_EXTERNAL_READ_BYTES} bytes. Narrow the file outside Pivi before reading it.`,
        );
      }
      if (!isRangeRead && fileStat.size > maxChars) {
        return textResult(buildExternalByteStatsText({
          path: fileStat.path,
          bytes: fileStat.size,
          maxChars,
          hardLimitBytes: MAX_EXTERNAL_READ_BYTES,
        }), {
          path: fileStat.path,
          bytes: fileStat.size,
          truncated: true,
          hardLimitBytes: MAX_EXTERNAL_READ_BYTES,
        });
      }
      const result = await externalFiles.readFile(absolutePath);
      const characters = result.content.length;
      const lineSpans = getLineSpans(result.content);
      const lines = lineSpans.length;
      const selectedContent = sliceLineRange(result.content, lineSpans, startLine, endLine);
      const selectedStats = isRangeRead ? getStats(selectedContent) : undefined;
      const large = !isRangeRead && characters > maxChars;

      const details = {
        path: result.path,
        characters,
        lines,
        wholeFile: { characters, lines },
        ...(selectedStats ? { selectedRange: { ...selectedStats, startLine, endLine } } : {}),
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
        truncated: large,
      };

      if (mode === 'stats' || large) {
        return textResult(buildStatsText({
          path: result.path,
          wholeFile: { characters, lines },
          selectedRange: selectedStats ? { ...selectedStats, startLine, endLine } : undefined,
          large,
          maxChars,
          readExternal: true,
        }), details);
      }

      if (selectedContent.length > maxChars) {
        throw new Error(
          `Selected content is ${selectedContent.length} characters, which exceeds maxChars=${maxChars}. Narrow startLine/endLine or raise maxChars deliberately.`,
        );
      }
      return textResult(selectedContent, details);
    },
  };
}
