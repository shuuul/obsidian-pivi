import { appendContextFiles } from '../../utils/context';
import { getTodayDate } from '../../utils/date';
import type {
  InlineEditCursorRequest,
  InlineEditRequest,
  InlineEditResult,
} from '../agent/types';

export function parseInlineEditResponse(responseText: string): InlineEditResult {
  const replacementMatch = responseText.match(/<replacement>([\s\S]*?)<\/replacement>/);
  if (replacementMatch) {
    return { success: true, editedText: replacementMatch[1] };
  }

  const insertionMatch = responseText.match(/<insertion>([\s\S]*?)<\/insertion>/);
  if (insertionMatch) {
    return { success: true, insertedText: insertionMatch[1] };
  }

  const trimmed = responseText.trim();
  if (trimmed) {
    return { success: true, clarification: trimmed };
  }

  return { success: false, error: 'Empty response' };
}

function buildCursorPrompt(request: InlineEditCursorRequest): string {
  const ctx = request.cursorContext;
  const lineAttr = ` line="${ctx.line + 1}"`;

  let cursorContent: string;
  if (ctx.isInbetween) {
    const parts = [];
    if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
    parts.push('| #inbetween');
    if (ctx.afterCursor) parts.push(ctx.afterCursor);
    cursorContent = parts.join('\n');
  } else {
    cursorContent = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
  }

  return [
    request.instruction,
    '',
    `<editor_cursor path="${request.notePath}"${lineAttr}>`,
    cursorContent,
    '</editor_cursor>',
  ].join('\n');
}

export function buildInlineEditPrompt(request: InlineEditRequest): string {
  let prompt: string;

  if (request.mode === 'cursor') {
    prompt = buildCursorPrompt(request);
  } else {
    const lineAttr = request.startLine && request.lineCount
      ? ` lines="${request.startLine}-${request.startLine + request.lineCount - 1}"`
      : '';
    prompt = [
      request.instruction,
      '',
      `<editor_selection path="${request.notePath}"${lineAttr}>`,
      request.selectedText,
      '</editor_selection>',
    ].join('\n');
  }

  if (request.contextFiles && request.contextFiles.length > 0) {
    prompt = appendContextFiles(prompt, request.contextFiles);
  }

  return prompt;
}

export function getInlineEditSystemPrompt(): string {
  const pathRules = '- **Paths**: Must be RELATIVE to vault root (e.g., "notes/file.md").';

  return `Today is ${getTodayDate()}.

You are **Obsius**, an expert editor and writing assistant embedded in Obsidian. You help users refine their text, answer questions, and generate content with high precision.

## Core Directives

1.  **Style Matching**: Mimic the user's tone, voice, and formatting style (indentation, bullet points, capitalization).
2.  **Context Awareness**: Read enough surrounding context to understand the topic before editing.
3.  **Silent Execution**: Use read-only tools when needed. Your final output must be ONLY the result.
4.  **No Fluff**: No pleasantries, no "Here is the text", no "I have updated...". Just the content.

## Input Format

User messages have the instruction first, followed by XML context tags.

### Selection Mode
Use \`<replacement>\` tags for edits.

### Cursor Mode
Use \`<insertion>\` tags to insert new content at the cursor position (\`|\`).

## Tools & Path Rules

${pathRules}

## Output Rules - CRITICAL

Your text output must contain ONLY the final answer, replacement, or insertion.

### When Replacing Selected Text (Selection Mode)
<replacement>your replacement text here</replacement>

### When Inserting at Cursor (Cursor Mode)
<insertion>your inserted text here</insertion>

### When Answering Questions
Respond WITHOUT tags. Output the answer directly.

### When Clarification is Needed
Ask a concise clarifying question.`;
}
