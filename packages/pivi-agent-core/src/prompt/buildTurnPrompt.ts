import { appendBrowserContext } from '../context/browser';
import { appendCanvasContext } from '../context/canvas';
import { appendContextFiles, appendCurrentNote } from '../context/context';
import { appendEditorContext } from '../context/editor';
import { appendInlineContexts } from '../context/inlineContext';
import type { McpServerManager } from '../mcp';
import { GENERATE_IMAGE_TOOL_ID } from '../skills/commands/slashCommandIds';
import { TOOL_OBSIDIAN_GENERATE_IMAGE } from '../tools/obsidianToolNames';
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

/** Expand built-in slash tool tokens for the model without changing durable UI text. */
export function transformBuiltInToolMentions(prompt: string): string {
  const token = new RegExp(`(^|\\s)/${GENERATE_IMAGE_TOOL_ID}(?=\\s|$)`, 'g');
  return prompt.replace(
    token,
    `$1Use the ${TOOL_OBSIDIAN_GENERATE_IMAGE} tool to generate an image. Image prompt:`,
  );
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

function appendTurnContexts(prompt: string, request: ChatTurnRequest): string {
  let result = prompt;

  if (request.currentNotePath) {
    result = appendCurrentNote(result, request.currentNotePath);
  }

  if (request.editorSelection) {
    result = appendEditorContext(result, request.editorSelection);
  }

  if (request.browserSelection) {
    result = appendBrowserContext(result, request.browserSelection);
  }

  if (request.canvasSelection) {
    result = appendCanvasContext(result, request.canvasSelection);
  }

  if (request.inlineContexts && request.inlineContexts.length > 0) {
    result = appendInlineContexts(result, request.inlineContexts);
  }

  const contextFiles = collectContextFilePaths(request);
  if (contextFiles.length > 0) {
    result = appendContextFiles(result, contextFiles);
  }

  return result;
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

  const persistedContent = appendTurnContexts(request.text, request);
  const prompt = appendTurnContexts(transformBuiltInToolMentions(request.text), request);

  return {
    prompt,
    persistedContent,
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
