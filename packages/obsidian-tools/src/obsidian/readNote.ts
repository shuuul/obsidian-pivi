import {
  textResult,
  TOOL_OBSIDIAN_READ,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';
import {
  buildStatsText,
  getLineSpans,
  getPositiveIntegerField,
  getReadMode,
  getStats,
  getStringField,
  OversizedFirstLineError,
  paginateCharacterRange,
  paginateLineRange,
  resolveEffectiveReadBudget,
  sliceLineRange,
} from './readShared';
import { rethrowIfUnmanagedVaultPath } from './unmanagedVaultPath';

interface LineCharacterPosition {
  line: number;
  character: number;
}

function getLineCharacterPosition(
  lineSpans: ReturnType<typeof getLineSpans>,
  globalChar: number,
): LineCharacterPosition {
  const index = globalChar - 1;
  let low = 0;
  let high = lineSpans.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const span = lineSpans[middle];
    if (!span) {
      break;
    }
    if (index < span.start) {
      high = middle - 1;
    } else if (index >= span.end) {
      low = middle + 1;
    } else {
      return { line: middle + 1, character: index - span.start + 1 };
    }
  }
  throw new Error(`Cannot map global character ${globalChar} to a physical line.`);
}

export function createReadNoteTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_READ,
    executionMode: 'sequential',
    label: 'Read note',
    description: 'Read a note body via vault API. Defaults to stats-only for large files; use line ranges for complete lines or startChar for bounded sequential slices of oversized physical lines. With startLine, startChar is relative to that physical line.',
    promptUsage: {
      summary: 'Read a note through the vault API. For potentially large files use stats first, then line ranges. For an oversized physical line, combine startLine with line-relative startChar and continue with the exact nextStartLine + nextStartChar pair returned by each truncated page.',
      parameters: '`file?` note title or `path?` exact vault-relative path (one required); `mode?` content|stats; `startLine?`/`endLine?` inclusive; 1-based UTF-16 `startChar?` is file-global alone or relative to `startLine` when combined; `maxChars?` total result cap.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (not a folder path)' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        startChar: { type: 'number', description: '1-based UTF-16 character position for a bounded sequential content page. It is file-global alone, or relative to startLine when startLine is provided; endLine may bound that line-relative read. On truncation, continue with the exact returned nextStartLine + nextStartChar pair for line-relative reads, or nextStartChar for global reads. Cannot be used with mode=stats.' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads, clamped between 1000 and 500000. When omitted, uses Tools → Default read size. An explicit value overrides that default; context overflow is handled by compaction preflight.' },
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
      const startChar = getPositiveIntegerField(input, 'startChar');
      if (startChar !== undefined && endLine !== undefined && startLine === undefined) {
        throw new Error('endLine with startChar requires startLine so startChar has an unambiguous line-relative origin.');
      }
      if (startChar !== undefined && mode === 'stats') {
        throw new Error('startChar cannot be used with mode="stats". Use mode="content" or omit mode.');
      }
      const readBudget = resolveEffectiveReadBudget(
        input,
        deps.settings.defaultReadMaxChars,
        mode === 'stats' ? undefined : deps.resolveReadMaxChars,
      );
      const maxChars = readBudget.maxChars;
      try {
        const result = await vault.readNote(file, notePath);
        const characters = result.content.length;
        const lineSpans = getLineSpans(result.content);
        const lines = lineSpans.length;
        const isRangeRead = startLine !== undefined || endLine !== undefined;
        const isCharacterRead = startChar !== undefined;
        const selectedContent = sliceLineRange(result.content, lineSpans, startLine, endLine);
        const selectedStats = isRangeRead ? getStats(selectedContent) : undefined;
        const large = !isRangeRead && !isCharacterRead && characters > maxChars;
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
          ...(startChar !== undefined ? { startChar } : {}),
          ...(requestedRange ? { requestedRange } : {}),
          truncated: large,
        };

        const returnCharacterPage = (
          pageStartChar: number,
          lineRelative?: { startLine: number; endLine?: number },
        ) => {
          const startSpan = lineRelative ? lineSpans[lineRelative.startLine - 1] : undefined;
          if (lineRelative && !startSpan) {
            readBudget.settle(0);
            return textResult('', {
              ...details,
              startLine: lineRelative.startLine,
              startChar: pageStartChar,
              characterCoordinate: 'line-relative',
              truncated: false,
            });
          }
          if (startSpan && pageStartChar > startSpan.end - startSpan.start) {
            throw new Error(
              `startChar=${pageStartChar} is beyond physical line ${lineRelative?.startLine},`
              + ` which has ${startSpan.end - startSpan.start} UTF-16 character positions including its line ending.`,
            );
          }
          const globalStartChar = startSpan
            ? startSpan.start + pageStartChar
            : pageStartChar;
          const requestedEndLine = lineRelative?.endLine ?? lines;
          const endSpan = lineRelative
            ? lineSpans[Math.min(requestedEndLine, lines) - 1]
            : undefined;
          const page = paginateCharacterRange(result.content, maxChars, globalStartChar, {
            ...(endSpan ? { endChar: endSpan.end } : {}),
            ...(lineRelative ? {
              buildContinuation: (returnedStart, returnedEnd, nextStart, pageMaxChars) => {
                const returnedFrom = getLineCharacterPosition(lineSpans, returnedStart);
                const returnedThrough = getLineCharacterPosition(lineSpans, returnedEnd);
                const next = getLineCharacterPosition(lineSpans, nextStart);
                const endLineParameter = lineRelative.endLine !== undefined
                  ? `, endLine=${lineRelative.endLine}`
                  : '';
                return `\n\n[Read truncated: returned from line ${returnedFrom.line}, character ${returnedFrom.character}`
                  + ` through line ${returnedThrough.line}, character ${returnedThrough.character}.`
                  + ` Continue with startLine=${next.line}, startChar=${next.character}${endLineParameter}, maxChars=${pageMaxChars}.]`;
              },
            } : {}),
          });
          readBudget.settle(page.content.length);
          if (lineRelative) {
            const returnedStart = page.returnedStartChar !== undefined
              ? getLineCharacterPosition(lineSpans, page.returnedStartChar)
              : undefined;
            const returnedEnd = page.returnedEndChar !== undefined
              ? getLineCharacterPosition(lineSpans, page.returnedEndChar)
              : undefined;
            const next = page.nextStartChar !== undefined
              ? getLineCharacterPosition(lineSpans, page.nextStartChar)
              : undefined;
            return textResult(page.content, {
              ...details,
              startLine: lineRelative.startLine,
              startChar: pageStartChar,
              characterCoordinate: 'line-relative',
              ...(returnedStart ? {
                returnedStartLine: returnedStart.line,
                returnedStartChar: returnedStart.character,
              } : {}),
              ...(returnedEnd ? {
                returnedEndLine: returnedEnd.line,
                returnedEndChar: returnedEnd.character,
              } : {}),
              truncated: page.truncated,
              ...(next ? { nextStartLine: next.line, nextStartChar: next.character } : {}),
            });
          }
          return textResult(page.content, {
            ...details,
            startChar: page.requestedStartChar,
            characterCoordinate: 'file-global',
            ...(page.returnedStartChar !== undefined ? { returnedStartChar: page.returnedStartChar } : {}),
            ...(page.returnedEndChar !== undefined ? { returnedEndChar: page.returnedEndChar } : {}),
            truncated: page.truncated,
            ...(page.nextStartChar !== undefined ? { nextStartChar: page.nextStartChar } : {}),
          });
        };

        if (mode === 'stats' || large) {
          const text = buildStatsText({
            path: result.path,
            wholeFile: { characters, lines },
            selectedRange: selectedStats ? { ...selectedStats, startLine, endLine } : undefined,
            large,
            maxChars,
            requestedMaxChars: readBudget.requestedMaxChars,
            availableChars: readBudget.availableChars,
          });
          readBudget.settle(text.length);
          return textResult(text, {
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

        if (startChar !== undefined) {
          return returnCharacterPage(
            startChar,
            startLine !== undefined ? { startLine, endLine } : undefined,
          );
        }

        if (isRangeRead) {
          let page;
          try {
            page = paginateLineRange(
              result.content,
              lineSpans,
              maxChars,
              startLine,
              endLine,
            );
          } catch (error) {
            if (error instanceof OversizedFirstLineError) {
              return returnCharacterPage(1, {
                startLine: requestedRange?.startLine ?? 1,
                endLine,
              });
            }
            throw error;
          }
          const returnedStats = getStats(page.rawContent);
          readBudget.settle(page.content.length);
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
        readBudget.settle(selectedContent.length);
        return textResult(selectedContent, details);
      } catch (error) {
        readBudget.settle(0);
        rethrowIfUnmanagedVaultPath(deps, { file, path: notePath }, error, 'file');
      }
    },
  };
}
