import { appendBrowserContext } from '../context/browser';
import { appendCanvasContext } from '../context/canvas';
import { appendContextFiles, appendCurrentNote } from '../context/context';
import { appendEditorContext } from '../context/editor';
import { appendInlineContexts } from '../context/inlineContext';
import type { McpServerManager } from '../mcp';
import type { BuiltTurnPrompt, ChatTurnRequest, ExternalContextAvailability } from './types';

function collectContextFilePaths(request: ChatTurnRequest): string[] {
  const paths = new Set<string>();

  for (const path of request.attachedFilePaths ?? []) {
    const trimmed = path.trim();
    if (trimmed) {
      paths.add(trimmed);
    }
  }

  return [...paths];
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Append current external-root availability to the API prompt only. */
export function appendExternalContextAvailability(
  prompt: string,
  contexts: readonly ExternalContextAvailability[],
): string {
  if (contexts.length === 0) return prompt;
  const rows = contexts.map((context) => {
    const reason = context.reason
      ? ` reason="${escapeXmlAttribute(context.reason)}"`
      : '';
    return `  <context path="${escapeXmlAttribute(context.path)}" available="${String(context.available)}"${reason} />`;
  });
  return `${prompt}\n\n<external_contexts>\n${rows.join('\n')}\n</external_contexts>`;
}

/**
 * Merges Obsidian context (current note, selection, attachments) into the LLM prompt.
 * User-visible text stays in `request.text`; XML context tags are appended for
 * the model and persisted as durable context references. Runtime/tool policy
 * belongs in the registered-tool system prompt, where tool availability is known.
 */
export function buildTurnPrompt(request: ChatTurnRequest): BuiltTurnPrompt {
  const isCompact = /^\/compact(\s|$)/i.test(request.text);
  if (isCompact) {
    return {
      prompt: request.text,
      persistedContent: request.text,
      isCompact: true,
    };
  }

  let prompt = request.text;

  if (request.currentNotePath) {
    prompt = appendCurrentNote(prompt, request.currentNotePath);
  }

  if (request.editorSelection) {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }

  if (request.inlineContexts && request.inlineContexts.length > 0) {
    prompt = appendInlineContexts(prompt, request.inlineContexts);
  }

  const contextFiles = collectContextFilePaths(request);
  if (contextFiles.length > 0) {
    prompt = appendContextFiles(prompt, contextFiles);
  }

  return {
    prompt,
    persistedContent: prompt,
    isCompact: false,
  };
}

type McpMentionOps = Pick<McpServerManager, 'extractMentions' | 'transformMentions'>;

/**
 * Applies MCP slash-token transforms for API prompts while keeping persisted UI text unchanged.
 */
export function finalizeTurnPrompt(
  built: BuiltTurnPrompt,
  request: ChatTurnRequest,
  mcpManager: McpMentionOps | null,
): {
  prompt: string;
  persistedContent: string;
  mcpMentions: Set<string>;
} {
  if (built.isCompact || !mcpManager) {
    return {
      prompt: built.prompt,
      persistedContent: built.persistedContent,
      mcpMentions: request.enabledMcpServers ?? new Set(),
    };
  }

  const mcpMentions = mcpManager.extractMentions(built.persistedContent);
  return {
    prompt: mcpManager.transformMentions(built.prompt),
    persistedContent: built.persistedContent,
    mcpMentions,
  };
}
