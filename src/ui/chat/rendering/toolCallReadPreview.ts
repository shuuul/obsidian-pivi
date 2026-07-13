import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_READ } from '@pivi/pivi-agent-core/tools/toolNames';

export interface MarkdownReadPreview {
  markdown: string;
  omittedLines: number;
  sourcePath: string;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isMarkdownPath(path: string): boolean {
  return /\.md(?:own)?$/i.test(path);
}

function truncateMarkdown(markdown: string, maxLines: number): Pick<MarkdownReadPreview, 'markdown' | 'omittedLines'> {
  const lines = markdown.split(/\r?\n/);
  if (lines.length <= maxLines) return { markdown, omittedLines: 0 };

  return {
    markdown: lines.slice(0, maxLines).join('\n'),
    omittedLines: lines.length - maxLines,
  };
}

export function resolveMarkdownReadPreview(toolCall: ToolCallInfo): MarkdownReadPreview | null {
  if (toolCall.status !== 'completed' || !toolCall.result || toolCall.input.mode === 'stats') {
    return null;
  }
  if (toolCall.toolUseResult?.truncated === true) return null;

  const resolvedPath = stringField(toolCall.toolUseResult, 'path')
    || stringField(toolCall.toolUseResult, 'filePath');

  if (toolCall.name === TOOL_OBSIDIAN_READ) {
    if (!resolvedPath) return null;
    return {
      ...truncateMarkdown(toolCall.result, 30),
      sourcePath: resolvedPath,
    };
  }

  if (toolCall.name !== TOOL_READ && toolCall.name !== TOOL_OBSIDIAN_READ_EXTERNAL) {
    return null;
  }

  const requestedPath = resolvedPath
    || stringField(toolCall.input, 'file_path')
    || stringField(toolCall.input, 'path')
    || stringField(toolCall.input, 'file');
  if (!isMarkdownPath(requestedPath)) return null;

  return {
    ...truncateMarkdown(toolCall.result, toolCall.name === TOOL_READ ? 15 : 30),
    // Generic/external reads may use absolute paths that are not valid vault link bases.
    sourcePath: '',
  };
}
