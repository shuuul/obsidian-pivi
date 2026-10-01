import {
  textResult,
  TOOL_OBSIDIAN_READ_EXTERNAL,
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
  paginateLineRange,
  resolveEffectiveReadBudget,
  sliceLineRange,
} from './readShared';
import { resolveExternalToolPath } from './resolveExternalToolPath';

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
    'Use `read` with 1-indexed `offset`/`limit` for smaller files, or inspect the file with a more specialized tool.',
    `External reads have a hard safety limit of ${params.hardLimitBytes} bytes.`,
  ].join('\n');
}

interface ExternalReadRequest {
  mode: ReturnType<typeof getReadMode>;
  startLine: number | undefined;
  endLine: number | undefined;
}

type ReadBudget = ReturnType<typeof resolveEffectiveReadBudget>;

/** Rejects files past the hard byte limit and answers with byte stats when a whole-file read cannot fit. */
function buildOversizedFileResult(
  fileStat: { path: string; size: number },
  { startLine, endLine }: ExternalReadRequest,
  readBudget: ReadBudget,
) {
  const maxChars = readBudget.maxChars;
  const isRangeRead = startLine !== undefined || endLine !== undefined;
  if (
    fileStat.size > MAX_EXTERNAL_READ_BYTES
    && (isRangeRead || (readBudget.requestedMaxChars ?? maxChars) >= fileStat.size)
  ) {
    throw new Error(
      `External file is ${fileStat.size} bytes, which exceeds the hard safety limit of ${MAX_EXTERNAL_READ_BYTES} bytes. Narrow the file outside Pivi before reading it.`,
    );
  }
  if (!isRangeRead && fileStat.size > maxChars) {
    const text = buildExternalByteStatsText({
      path: fileStat.path,
      bytes: fileStat.size,
      maxChars,
      hardLimitBytes: MAX_EXTERNAL_READ_BYTES,
    });
    readBudget.settle(text.length);
    return textResult(text, {
      path: fileStat.path,
      bytes: fileStat.size,
      truncated: true,
      hardLimitBytes: MAX_EXTERNAL_READ_BYTES,
    });
  }
  return undefined;
}

function buildExternalReadResult(
  result: { path: string; content: string },
  { mode, startLine, endLine }: ExternalReadRequest,
  readBudget: ReadBudget,
) {
  const maxChars = readBudget.maxChars;
  const isRangeRead = startLine !== undefined || endLine !== undefined;
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
    const text = buildStatsText({
      path: result.path,
      wholeFile: { characters, lines },
      selectedRange: selectedStats ? { ...selectedStats, startLine, endLine } : undefined,
      large,
      maxChars,
      requestedMaxChars: readBudget.requestedMaxChars,
      availableChars: readBudget.availableChars,
      readExternal: true,
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

  if (isRangeRead) {
    const page = paginateLineRange(
      result.content,
      lineSpans,
      maxChars,
      startLine,
      endLine,
    );
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
}

export function createReadExternalTool(deps: ObsidianToolDeps): ToolSpec {
  return {
    name: TOOL_OBSIDIAN_READ_EXTERNAL,
    executionMode: 'sequential',
    label: 'Read external file',
    description: 'Read an external file by absolute path, or by a vault-relative path that is resolved against the current vault. Defaults to stats-only for large files; explicit line ranges automatically return the largest complete-line page that fits maxChars and provide nextStartLine when more remains.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path, or a vault-relative path such as .pivi/skills/demo/SKILL.md' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        maxChars: { type: 'number', description: 'Maximum characters to return for content reads, clamped between 1000 and 500000. When omitted, uses Tools → Default read size. An explicit value overrides that default; context overflow is handled by compaction preflight.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const requestedPath = getStringField(input, 'path');
      if (!requestedPath) {
        throw new Error('Invalid read external input: path must be an absolute string.');
      }
      const absolutePath = resolveExternalToolPath(deps, requestedPath);
      const request: ExternalReadRequest = {
        mode: getReadMode(input),
        startLine: getPositiveIntegerField(input, 'startLine'),
        endLine: getPositiveIntegerField(input, 'endLine'),
      };
      const readBudget = resolveEffectiveReadBudget(
        input,
        deps.settings.defaultReadMaxChars,
        request.mode === 'stats' ? undefined : deps.resolveReadMaxChars,
      );
      try {
        const externalFiles = await ensureExternalDirectoryAccess(
          deps,
          absolutePath,
          false,
          CAPABILITY_TOOL_NAMES.readExternal,
        );
        const oversized = buildOversizedFileResult(externalFiles.stat(absolutePath), request, readBudget);
        if (oversized) {
          return oversized;
        }
        const result = await externalFiles.readFile(absolutePath);
        return buildExternalReadResult(result, request, readBudget);
      } catch (error) {
        readBudget.settle(0);
        throw error;
      }
    },
  };
}
