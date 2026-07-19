import {
  textResult,
  TOOL_OBSIDIAN_READ,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

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

export function createReadNoteTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_READ,
    executionMode: 'sequential',
    label: 'Read note',
    description: 'Read a note body via vault API. Defaults to stats-only for large files; explicit line ranges automatically return the largest complete-line page that fits maxChars and provide nextStartLine when more remains.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (not a folder path)' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads, clamped to at least 1000. Defaults to the smaller of remaining room before the output reserve and 50000 (may cross the compaction threshold). To read a full large file, first use mode=stats, then set maxChars to at least the reported Characters value deliberately.' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid read note input: file or path must be a string.');
      }
      const mode = getReadMode(input);
      const startLine = getPositiveIntegerField(input, 'startLine');
      const endLine = getPositiveIntegerField(input, 'endLine');
      const maxChars = resolveEffectiveReadMaxChars(
        input,
        mode === 'stats' ? undefined : deps.resolveReadMaxChars,
      );
      const result = await vault.readNote(file, notePath);
      const characters = result.content.length;
      const lineSpans = getLineSpans(result.content);
      const lines = lineSpans.length;
      const isRangeRead = startLine !== undefined || endLine !== undefined;
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
