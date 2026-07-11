import type { LineSpan, ReadMode, ReadStats } from './readTypes';

export * from './readTypes';

export const DEFAULT_SAFE_READ_MAX_CHARS = 20_000;

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
  const end = endLine ?? spans.length;
  if (end < start) {
    throw new Error('endLine must be greater than or equal to startLine.');
  }
  const firstSpan = spans[start - 1];
  if (!firstSpan) {
    return '';
  }
  const lastSpan = spans[Math.min(end, spans.length) - 1];
  if (!lastSpan) {
    return '';
  }
  return content.slice(firstSpan.start, lastSpan.end);
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
