import {
  calculateReadToolMaxChars,
  READ_TOOL_MIN_CHARS,
} from '@pivi/pivi-agent-core/foundation/usage';

import type { LineSpan, ReadMode, ReadStats } from './readTypes';

export * from './readTypes';
export { READ_TOOL_MAX_CHARS_CAP as DEFAULT_SAFE_READ_MAX_CHARS } from '@pivi/pivi-agent-core/foundation/usage';

export function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function getPositiveIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

export function resolveEffectiveReadMaxChars(
  input: Record<string, unknown>,
  resolveDefault?: (requestedMaxChars?: number) => number,
): number {
  const explicit = getPositiveIntegerField(input, 'maxChars');
  const requested = explicit ?? calculateReadToolMaxChars(null);
  const available = resolveDefault?.(explicit) ?? requested;
  return Math.max(READ_TOOL_MIN_CHARS, Math.min(requested, available));
}

export function getReadMode(input: Record<string, unknown>): ReadMode {
  const mode = input.mode;
  if (mode === undefined || mode === 'content') {
    return 'content';
  }
  if (mode === 'stats') {
    return 'stats';
  }
  throw new Error('mode must be "content" or "stats".');
}

export function getLineSpans(content: string): LineSpan[] {
  if (content.length === 0) {
    return [];
  }
  const spans: LineSpan[] = [];
  const pattern = /.*?(?:\r\n|\n|\r|$)/g;
  for (const match of content.matchAll(pattern)) {
    const [text] = match;
    if (!text) {
      continue;
    }
    const start = match.index ?? 0;
    spans.push({ start, end: start + text.length });
  }
  return spans;
}

export function sliceLineRange(content: string, spans: LineSpan[], startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) {
    return content;
  }
  const start = startLine ?? 1;
  if (endLine !== undefined && endLine < start) {
    throw new Error('endLine must be greater than or equal to startLine.');
  }
  const firstSpan = spans[start - 1];
  if (!firstSpan) {
    return '';
  }
  const end = endLine ?? spans.length;
  const lastSpan = spans[Math.min(end, spans.length) - 1];
  if (!lastSpan) {
    return '';
  }
  return content.slice(firstSpan.start, lastSpan.end);
}

export interface PaginatedLineRange {
  content: string;
  rawContent: string;
  requestedStartLine: number;
  requestedEndLine: number;
  returnedStartLine?: number;
  returnedEndLine?: number;
  truncated: boolean;
  nextStartLine?: number;
}

function buildRangeContinuation(
  requestedStartLine: number,
  requestedEndLine: number,
  returnedEndLine: number,
): string {
  const nextStartLine = returnedEndLine + 1;
  return `\n\n[Read truncated: returned lines ${requestedStartLine}-${returnedEndLine}`
    + ` of requested ${requestedStartLine}-${requestedEndLine}.`
    + ` Continue with startLine=${nextStartLine}, endLine=${requestedEndLine}.]`;
}

export function paginateLineRange(
  content: string,
  spans: LineSpan[],
  maxChars: number,
  startLine?: number,
  endLine?: number,
): PaginatedLineRange {
  const requestedStartLine = startLine ?? 1;
  const requestedEndLine = endLine ?? spans.length;
  if (endLine !== undefined && requestedEndLine < requestedStartLine) {
    throw new Error('endLine must be greater than or equal to startLine.');
  }

  const firstSpan = spans[requestedStartLine - 1];
  if (!firstSpan) {
    return {
      content: '',
      rawContent: '',
      requestedStartLine,
      requestedEndLine,
      truncated: false,
    };
  }

  const actualEndLine = Math.min(requestedEndLine, spans.length);
  const lastSpan = spans[actualEndLine - 1];
  if (!lastSpan) {
    return {
      content: '',
      rawContent: '',
      requestedStartLine,
      requestedEndLine,
      truncated: false,
    };
  }

  const fullRange = content.slice(firstSpan.start, lastSpan.end);
  if (fullRange.length <= maxChars) {
    return {
      content: fullRange,
      rawContent: fullRange,
      requestedStartLine,
      requestedEndLine,
      returnedStartLine: requestedStartLine,
      returnedEndLine: actualEndLine,
      truncated: false,
    };
  }

  let returnedEndLine: number | undefined;
  let rawContent = '';
  let output = '';
  for (let line = requestedStartLine; line <= actualEndLine; line++) {
    const span = spans[line - 1];
    if (!span) break;
    const candidateRaw = content.slice(firstSpan.start, span.end);
    const continuation = buildRangeContinuation(requestedStartLine, requestedEndLine, line);
    const candidateOutput = `${candidateRaw}${continuation}`;
    if (candidateOutput.length > maxChars) {
      break;
    }
    returnedEndLine = line;
    rawContent = candidateRaw;
    output = candidateOutput;
  }

  if (returnedEndLine === undefined) {
    const firstLineLength = firstSpan.end - firstSpan.start;
    const minimumBudget = firstLineLength
      + buildRangeContinuation(requestedStartLine, requestedEndLine, requestedStartLine).length;
    throw new Error(
      `Line ${requestedStartLine} is ${firstLineLength} characters and cannot fit within maxChars=${maxChars}`
      + ` with the continuation marker. Raise maxChars to at least ${minimumBudget}.`,
    );
  }

  return {
    content: output,
    rawContent,
    requestedStartLine,
    requestedEndLine,
    returnedStartLine: requestedStartLine,
    returnedEndLine,
    truncated: true,
    nextStartLine: returnedEndLine + 1,
  };
}

export function getStats(content: string): ReadStats {
  return {
    characters: content.length,
    lines: getLineSpans(content).length,
  };
}

export function buildStatsText(params: {
  path: string;
  wholeFile: ReadStats;
  selectedRange?: ReadStats & { startLine?: number; endLine?: number };
  large: boolean;
  maxChars: number;
  readExternal?: boolean;
}): string {
  const lines = [
    `Path: ${params.path}`,
    `Lines: ${params.wholeFile.lines}`,
    `Characters: ${params.wholeFile.characters}`,
  ];
  if (params.selectedRange) {
    lines.push(
      '',
      'Selected range:',
      ...(params.selectedRange.startLine !== undefined ? [`Start line: ${params.selectedRange.startLine}`] : []),
      ...(params.selectedRange.endLine !== undefined ? [`End line: ${params.selectedRange.endLine}`] : []),
      `Lines: ${params.selectedRange.lines}`,
      `Characters: ${params.selectedRange.characters}`,
    );
  }
  if (params.large) {
    const readTool = params.readExternal ? 'obsidian_read_external' : 'obsidian_read';
    lines.push(
      '',
      `Large file: content was not returned because it exceeds ${params.maxChars} characters.`,
      `Call ${readTool} with startLine/endLine for the needed section.`,
      `If you truly need the entire file, call ${readTool} again with maxChars set to at least ${params.wholeFile.characters}; do this deliberately because the full file will be added to context.`,
    );
  }
  return lines.join('\n');
}
