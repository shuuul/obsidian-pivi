/**
 * Explicit editor-selection context for chat turns (user-attached chips).
 */

export interface InlineContextPosition {
  line: number;
  ch: number;
}

export interface InlineContextReference {
  type: 'editor-selection';
  notePath: string;
  noteName: string;
  /** 0-indexed CodeMirror/Obsidian positions for the exact selected span. */
  selection: {
    from: InlineContextPosition;
    to: InlineContextPosition;
  };
  /** 1-indexed inclusive line range included in the prompt body. */
  includedLines: {
    from: number;
    to: number;
  };
  /** Snapshot at attach time. */
  text: string;
}

interface SerializedInlineContextReference extends InlineContextReference {
  version: 1;
}

const INLINE_CONTEXT_TOKEN_PREFIX = '@[pivi-inline-context:';
const INLINE_CONTEXT_TOKEN_REGEX = /@\[pivi-inline-context:([A-Za-z0-9_-]+)\]/g;

export interface NormalizedEditorSelection {
  from: InlineContextPosition;
  to: InlineContextPosition;
  includedLineFrom: number;
  includedLineTo: number;
}

/** Normalize reversed selections so from <= to (line, then ch). */
export function normalizeEditorSelection(
  from: InlineContextPosition,
  to: InlineContextPosition,
): NormalizedEditorSelection {
  const reversed = from.line > to.line || (from.line === to.line && from.ch > to.ch);
  const normalizedFrom = reversed ? to : from;
  const normalizedTo = reversed ? from : to;
  return {
    from: normalizedFrom,
    to: normalizedTo,
    includedLineFrom: normalizedFrom.line,
    includedLineTo: normalizedTo.line,
  };
}

/**
 * Builds prompt body text from full touched lines with selection markers.
 * Positions are 0-indexed line/ch (Obsidian editor).
 */
export function buildMarkedSelectionText(
  getLine: (line: number) => string,
  from: InlineContextPosition,
  to: InlineContextPosition,
): string {
  const { from: selFrom, to: selTo, includedLineFrom, includedLineTo } = normalizeEditorSelection(from, to);
  const lines: string[] = [];

  for (let line = includedLineFrom; line <= includedLineTo; line++) {
    const lineText = getLine(line);
    if (line === selFrom.line && line === selTo.line) {
      const before = lineText.slice(0, selFrom.ch);
      const selected = lineText.slice(selFrom.ch, selTo.ch);
      const after = lineText.slice(selTo.ch);
      lines.push(`${before}<selection_start>${selected}<selection_end>${after}`);
      continue;
    }
    if (line === selFrom.line) {
      const before = lineText.slice(0, selFrom.ch);
      const selected = lineText.slice(selFrom.ch);
      lines.push(`${before}<selection_start>${selected}`);
      continue;
    }
    if (line === selTo.line) {
      const selected = lineText.slice(0, selTo.ch);
      const after = lineText.slice(selTo.ch);
      lines.push(`${selected}<selection_end>${after}`);
      continue;
    }
    lines.push(lineText);
  }

  return lines.join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 1-indexed line:column for prompt attributes. */
export function formatSelectionRangeAttribute(
  from: InlineContextPosition,
  to: InlineContextPosition,
): string {
  const { from: selFrom, to: selTo } = normalizeEditorSelection(from, to);
  return `${selFrom.line + 1}:${selFrom.ch + 1}-${selTo.line + 1}:${selTo.ch + 1}`;
}

export function formatInlineContextBlock(context: InlineContextReference): string {
  const range = formatSelectionRangeAttribute(context.selection.from, context.selection.to);
  const included = `${context.includedLines.from}-${context.includedLines.to}`;
  const path = escapeXmlAttribute(context.notePath);
  return [
    `<inline_context path="${path}" range="${range}" included_lines="${included}">`,
    'The following lines were explicitly attached by the user. The exact selected span is marked with <selection_start> and <selection_end>.',
    '',
    context.text,
    '</inline_context>',
  ].join('\n');
}

export function formatInlineContexts(contexts: InlineContextReference[]): string {
  if (contexts.length === 0) {
    return '';
  }
  const blocks = contexts.map((ctx) => formatInlineContextBlock(ctx));
  return `<inline_contexts>\n${blocks.join('\n')}\n</inline_contexts>`;
}

export function appendInlineContexts(prompt: string, contexts: InlineContextReference[]): string {
  const formatted = formatInlineContexts(contexts);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}

export function inlineContextsAreEqual(
  left: InlineContextReference,
  right: InlineContextReference,
): boolean {
  return left.notePath === right.notePath
    && left.selection.from.line === right.selection.from.line
    && left.selection.from.ch === right.selection.from.ch
    && left.selection.to.line === right.selection.to.line
    && left.selection.to.ch === right.selection.to.ch;
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string | null {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(paddingNeeded);

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isValidPosition(position: unknown): position is InlineContextPosition {
  if (!position || typeof position !== 'object' || !('line' in position) || !('ch' in position)) {
    return false;
  }
  const p = position;
  return typeof p.line === 'number'
    && typeof p.ch === 'number'
    && Number.isInteger(p.line)
    && Number.isInteger(p.ch)
    && p.line >= 0
    && p.ch >= 0;
}

function isInlineContextReference(value: unknown): value is SerializedInlineContextReference {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const ctx = value as Partial<SerializedInlineContextReference>;
  return ctx.version === 1
    && ctx.type === 'editor-selection'
    && typeof ctx.notePath === 'string'
    && typeof ctx.noteName === 'string'
    && typeof ctx.text === 'string'
    && !!ctx.selection
    && isValidPosition(ctx.selection.from)
    && isValidPosition(ctx.selection.to)
    && !!ctx.includedLines
    && typeof ctx.includedLines.from === 'number'
    && typeof ctx.includedLines.to === 'number';
}

export function createInlineContextToken(context: InlineContextReference): string {
  const serialized: SerializedInlineContextReference = {
    ...context,
    version: 1,
  };
  return `${INLINE_CONTEXT_TOKEN_PREFIX}${toBase64Url(JSON.stringify(serialized))}]`;
}

export function parseInlineContextToken(token: string): InlineContextReference | null {
  const match = token.match(/^@\[pivi-inline-context:([A-Za-z0-9_-]+)\]$/);
  if (!match) {
    return null;
  }

  const decoded = fromBase64Url(match[1]);
  if (!decoded) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(decoded);
    if (!isInlineContextReference(parsed)) {
      return null;
    }
    return {
      type: 'editor-selection',
      notePath: parsed.notePath,
      noteName: parsed.noteName,
      selection: {
        from: parsed.selection.from,
        to: parsed.selection.to,
      },
      includedLines: {
        from: parsed.includedLines.from,
        to: parsed.includedLines.to,
      },
      text: parsed.text,
    };
  } catch {
    return null;
  }
}

export function extractInlineContextTokensFromMessage(message: string): {
  messageWithoutInlineContextTokens: string;
  contexts: InlineContextReference[];
  tokens: string[];
} {
  const contexts: InlineContextReference[] = [];
  const tokens: string[] = [];

  INLINE_CONTEXT_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_CONTEXT_TOKEN_REGEX.exec(message)) !== null) {
    const token = match[0];
    const context = parseInlineContextToken(token);
    if (!context) {
      continue;
    }
    if (contexts.some((existing) => inlineContextsAreEqual(existing, context))) {
      continue;
    }
    contexts.push(context);
    tokens.push(token);
  }

  return {
    messageWithoutInlineContextTokens: message
      .replace(INLINE_CONTEXT_TOKEN_REGEX, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    contexts,
    tokens,
  };
}
