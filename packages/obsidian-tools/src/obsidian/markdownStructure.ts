import {
  textResult,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

const DEFAULT_MAX_HEADINGS = 200;

interface MarkdownHeading {
  level: number;
  text: string;
  line: number;
  charStart: number;
  sectionChars: number;
  charsSincePreviousHeading: number;
}

interface MarkdownLine {
  text: string;
  start: number;
}

interface ActiveFence {
  char: '`' | '~';
  length: number;
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

function stripClosingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

function getFenceMarker(line: string): ActiveFence | undefined {
  const match = /^\s*([`~]{3,})/.exec(line);
  if (!match) {
    return undefined;
  }
  const marker = match[1];
  if (!marker) {
    return undefined;
  }
  const char = marker[0];
  if ((char !== '`' && char !== '~') || !marker.split('').every((value) => value === char)) {
    return undefined;
  }
  return { char, length: marker.length };
}

function closesFence(line: string, fence: ActiveFence): boolean {
  const trimmedStart = line.replace(/^[ \t]*/, '');
  let markerLength = 0;
  while (trimmedStart[markerLength] === fence.char) {
    markerLength++;
  }
  return markerLength >= fence.length && /^[ \t]*$/.test(trimmedStart.slice(markerLength));
}

function getSetextHeadingLevel(line: string): 1 | 2 | undefined {
  if (/^[ \t]*=+[ \t]*$/.test(line)) {
    return 1;
  }
  if (/^[ \t]*-+[ \t]*$/.test(line)) {
    return 2;
  }
  return undefined;
}

function isSetextHeadingText(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/^(#{1,6})(?:[ \t]+|$)/.test(trimmed) && !getSetextHeadingLevel(trimmed);
}

function getMarkdownLines(content: string): MarkdownLine[] {
  if (content.length === 0) {
    return [];
  }
  const lines: MarkdownLine[] = [];
  const pattern = /.*?(?:\r\n|\n|\r|$)/g;
  for (const match of content.matchAll(pattern)) {
    const raw = match[0];
    if (raw.length === 0) {
      continue;
    }
    lines.push({
      text: raw.replace(/\r\n$|\n$|\r$/, ''),
      start: match.index ?? 0,
    });
  }
  return lines;
}

function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const lines = getMarkdownLines(content);

  let activeFence: ActiveFence | undefined;
  const rawHeadings: Array<Omit<MarkdownHeading, 'sectionChars' | 'charsSincePreviousHeading'>> = [];
  for (let i = 0; i < lines.length; i++) {
    const markdownLine = lines[i];
    if (!markdownLine) continue;
    const { text: line, start } = markdownLine;
    if (activeFence) {
      if (closesFence(line, activeFence)) {
        activeFence = undefined;
      }
      continue;
    }

    const fence = getFenceMarker(line);
    if (fence) {
      activeFence = fence;
      continue;
    }

    const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    const level = match?.[1];
    const headingText = match?.[2];
    if (level && headingText) {
      rawHeadings.push({
        level: level.length,
        text: stripClosingHashes(headingText),
        line: i + 1,
        charStart: start,
      });
      continue;
    }

    const setextLevel = getSetextHeadingLevel(line);
    const previousLine = lines[i - 1];
    if (setextLevel && previousLine && isSetextHeadingText(previousLine.text)) {
      rawHeadings.push({
        level: setextLevel,
        text: previousLine.text.trim(),
        line: i,
        charStart: previousLine.start,
      });
    }
  }

  return rawHeadings.map((heading, index) => {
    const nextHeading = rawHeadings[index + 1];
    const previousHeading = rawHeadings[index - 1];
    return {
      ...heading,
      sectionChars: (nextHeading?.charStart ?? content.length) - heading.charStart,
      charsSincePreviousHeading: previousHeading ? heading.charStart - previousHeading.charStart : heading.charStart,
    };
  });
}

export function createMarkdownStructureTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
    label: 'Markdown structure',
    description: 'Extract Markdown heading structure with line numbers and character counts before selectively reading large files.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (not a folder path)' },
        path: { type: 'string', description: 'Vault-relative Markdown path, e.g. folder/note.md' },
        maxHeadings: { type: 'number', description: 'Maximum headings to return (default 200)' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid markdown structure input: file or path must be a string.');
      }
      const maxHeadings = getPositiveIntegerField(input, 'maxHeadings') ?? DEFAULT_MAX_HEADINGS;
      const result = await vault.readNote(file, notePath);
      const headings = extractMarkdownHeadings(result.content);
      const returnedHeadings = headings.slice(0, maxHeadings);
      const body = JSON.stringify({
        path: result.path,
        lines: getMarkdownLines(result.content).length,
        characters: result.content.length,
        headings: returnedHeadings,
        truncated: headings.length > returnedHeadings.length,
        totalHeadings: headings.length,
      }, null, 2);
      return textResult(body, {
        path: result.path,
        characters: result.content.length,
        totalHeadings: headings.length,
        truncated: headings.length > returnedHeadings.length,
      });
    },
  };
}
