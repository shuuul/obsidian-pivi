import {
  textResult,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { CAPABILITY_TOOL_NAMES, ensureExternalDirectoryAccess } from '../capabilityApprovalGate';
import type { ObsidianToolDeps } from './deps';
import {
  buildStatsText,
  getLineSpans,
  getPositiveIntegerField,
  getReadMode,
  getStats,
  getStringField,
  paginateLineRange,
  resolveEffectiveReadMaxChars,
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
  return {
    name: TOOL_OBSIDIAN_READ_EXTERNAL,
    executionMode: 'sequential',
    label: 'Read external file',
    description: 'Read an external file by absolute path. Defaults to stats-only for large files; explicit line ranges automatically return the largest complete-line page that fits maxChars and provide nextStartLine when more remains.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path, e.g. /Users/me/Workspace/file.ts' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads, clamped to at least 1000. Defaults to the smaller of remaining room before the output reserve and 50000 (may cross the compaction threshold). To read a full large file, first use mode=stats, then set maxChars to at least the reported Characters value deliberately.' },
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
      const maxChars = resolveEffectiveReadMaxChars(
        input,
        mode === 'stats' ? undefined : deps.resolveReadMaxChars,
      );
      const externalFiles = await ensureExternalDirectoryAccess(
        deps,
        absolutePath,
        false,
        CAPABILITY_TOOL_NAMES.readExternal,
      );
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
      const requestedRange = isRangeRead
        ? { startLine: startLine ?? 1, endLine: endLine ?? lines }
        : undefined;

      const details = {
        path: result.path,
        characters,
        lines,
        wholeFile: { characters, lines },
        ...(selectedStats ? { selectedRange: { ...selectedStats, startLine, endLine } } : {}),
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
        ...(requestedRange ? { requestedRange } : {}),
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
        }), {
          ...details,
          ...(selectedStats && selectedStats.lines > 0 && requestedRange ? {
            returnedRange: {
              ...selectedStats,
              startLine: requestedRange.startLine,
              endLine: Math.min(requestedRange.endLine, lines),
            },
          } : {}),
        });
      }

      if (isRangeRead) {
        const page = paginateLineRange(result.content, lineSpans, maxChars, startLine, endLine);
        const returnedStats = getStats(page.rawContent);
        return textResult(page.content, {
          ...details,
          ...(page.returnedStartLine !== undefined && page.returnedEndLine !== undefined ? {
            returnedRange: {
              ...returnedStats,
              startLine: page.returnedStartLine,
              endLine: page.returnedEndLine,
            },
          } : {}),
          truncated: page.truncated,
          ...(page.nextStartLine !== undefined ? { nextStartLine: page.nextStartLine } : {}),
        });
      }
      return textResult(selectedContent, details);
    },
  };
}
