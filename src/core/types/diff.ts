/**
 * Diff-related type definitions.
 */

export interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** A single hunk from structuredPatch on Write/Edit tool results. */
export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** Structured tool result payload for Write/Edit tools (diff hunks, file path). */
export interface ToolUseResult {
  structuredPatch?: StructuredPatchHunk[];
  filePath?: string;
  [key: string]: unknown;
}
