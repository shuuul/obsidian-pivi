import * as path from 'node:path';

import {
  textResult,
  TOOL_OBSIDIAN_READ,
  type ToolSpec,
} from '@pivi/agent/tools';

import { CAPABILITY_TOOL_NAMES, ensureExternalDirectoryAccess } from '../capabilityApprovalGate';
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
import { resolveExternalToolPath } from './resolveExternalToolPath';
import { resolveUnmanagedAbsolutePath } from './unmanagedVaultPath';

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
    label: 'Read',
    description: 'Read a file. Vault-indexed notes use the vault API; unindexed vault files such as `.pivi/` and absolute paths use the filesystem. Defaults to stats-only for large files. Use 1-indexed offset/limit for complete lines, or startChar for oversized physical lines.',
    promptUsage: {
      summary: 'Read a file. For potentially large files use stats first, then 1-indexed `offset`/`limit` line pages. For an oversized physical line, combine `offset` with line-relative `startChar` and continue with the exact `nextStartLine` + `nextStartChar` pair. Line-page truncation also returns `nextOffset`. Use `file` only when you have a note title and no path.',
      parameters: '`path?` vault-relative, unindexed, or absolute path, or `file?` wikilink title (one required); `mode?` content|stats; `offset?` 1-indexed start line; `limit?` line count; 1-based UTF-16 `startChar?` is file-global alone or relative to `offset` when combined; `maxChars?` total result cap.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name when you have no path' },
        path: { type: 'string', description: 'Vault-relative path, unindexed vault path, or absolute filesystem path' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        offset: { type: 'number', description: '1-indexed first line to read' },
        limit: { type: 'number', description: 'Number of lines to read from offset' },
        startChar: { type: 'number', description: '1-based UTF-16 character position for a bounded sequential content page. It is file-global alone, or relative to offset when offset is provided. On truncation, continue with the exact returned nextStartLine + nextStartChar pair. Cannot be used with mode=stats.' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads, clamped between 1000 and 500000. When omitted, uses Tools → Default read size.' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid read input: path or file must be a string.');
      }
      const mode = getReadMode(input);
      const offset = getPositiveIntegerField(input, 'offset');
      const limit = getPositiveIntegerField(input, 'limit');
      const startLine = offset ?? getPositiveIntegerField(input, 'startLine');
      const explicitEndLine = getPositiveIntegerField(input, 'endLine');
      const endLine = explicitEndLine
        ?? (startLine !== undefined && limit !== undefined ? startLine + limit - 1 : undefined);
      const startChar = getPositiveIntegerField(input, 'startChar');
      if (startChar !== undefined && endLine !== undefined && startLine === undefined) {
        throw new Error('endLine with startChar requires offset so startChar has an unambiguous line-relative origin.');
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
      const readVaultNote = async (): Promise<{ path: string; content: string }> => {
        try {
          return await vault.readNote(file, notePath);
        } catch (error) {
          const absolute = resolveUnmanagedAbsolutePath(deps, { file, path: notePath }, error, 'file');
          if (!absolute) {
            throw error;
          }
          const externalFiles = await ensureExternalDirectoryAccess(
            deps,
            absolute,
            false,
            CAPABILITY_TOOL_NAMES.readExternal,
          );
          return externalFiles.readFile(absolute);
        }
      };
      const readAbsolutePath = async (requested: string): Promise<{ path: string; content: string }> => {
        const absolutePath = path.isAbsolute(requested)
          ? requested
          : resolveExternalToolPath(deps, requested);
        const externalFiles = await ensureExternalDirectoryAccess(
          deps,
          absolutePath,
          false,
          CAPABILITY_TOOL_NAMES.readExternal,
        );
        return externalFiles.readFile(absolutePath);
      };
      try {
        const result = notePath && path.isAbsolute(notePath)
          ? await readAbsolutePath(notePath)
          : await readVaultNote();
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
            ...(page.nextStartLine !== undefined ? { nextOffset: page.nextStartLine } : {}),
          });
        }
        readBudget.settle(selectedContent.length);
        return textResult(selectedContent, details);
      } catch (error) {
        readBudget.settle(0);
        throw error;
      }
    },
  };
}
