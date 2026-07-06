import {
  textResult,
  TOOL_OBSIDIAN_READ,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

const DEFAULT_SAFE_READ_MAX_CHARS = 20_000;

type ReadMode = 'content' | 'stats';

interface LineSpan {
  start: number;
  contentEnd: number;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getPositiveIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function getReadMode(input: Record<string, unknown>): ReadMode {
  const mode = input.mode;
  if (mode === undefined || mode === 'content') {
    return 'content';
  }
  if (mode === 'stats') {
    return 'stats';
  }
  throw new Error('mode must be "content" or "stats".');
}

function getLineSpans(content: string): LineSpan[] {
  if (content.length === 0) {
    return [];
  }
  const spans: LineSpan[] = [];
  const pattern = /.*?(?:\r\n|\n|\r|$)/g;
  for (const match of content.matchAll(pattern)) {
    const text = match[0];
    if (text.length === 0) {
      continue;
    }
    const start = match.index ?? 0;
    const contentEnd = start + text.replace(/\r\n$|\n$|\r$/, '').length;
    spans.push({ start, contentEnd });
  }
  return spans;
}

function sliceLineRange(content: string, spans: LineSpan[], startLine?: number, endLine?: number): string {
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
  return content.slice(firstSpan.start, lastSpan.contentEnd);
}

function buildStatsText(params: {
  path: string;
  characters: number;
  lines: number;
  large: boolean;
  maxChars: number;
}): string {
  const lines = [
    `Path: ${params.path}`,
    `Lines: ${params.lines}`,
    `Characters: ${params.characters}`,
  ];
  if (params.large) {
    lines.push(
      '',
      `Large file: content was not returned because it exceeds ${params.maxChars} characters.`,
      'Use obsidian_markdown_structure to inspect headings, then call obsidian_read with startLine/endLine for the needed section.',
    );
  }
  return lines.join('\n');
}

export function createReadNoteTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_READ,
    label: 'Read note',
    description: 'Read a note body via vault API. Use mode=stats before large reads, or startLine/endLine to read only a section.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (not a folder path)' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        mode: { type: 'string', enum: ['content', 'stats'], description: 'stats returns only path, line count, and character count' },
        startLine: { type: 'number', description: '1-based first line to read' },
        endLine: { type: 'number', description: '1-based last line to read, inclusive' },
        maxChars: { type: 'number', description: 'Maximum characters to return for full content reads (default 20000)' },
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
      const maxChars = getPositiveIntegerField(input, 'maxChars') ?? DEFAULT_SAFE_READ_MAX_CHARS;
      const result = await vault.readNote(file, notePath);
      const characters = result.content.length;
      const lineSpans = getLineSpans(result.content);
      const lines = lineSpans.length;
      const isRangeRead = startLine !== undefined || endLine !== undefined;
      const selectedContent = sliceLineRange(result.content, lineSpans, startLine, endLine);
      const large = !isRangeRead && characters > maxChars;

      const details = {
        path: result.path,
        characters,
        lines,
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
        truncated: large,
      };

      if (mode === 'stats' || large) {
        return textResult(buildStatsText({ path: result.path, characters, lines, large, maxChars }), details);
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
