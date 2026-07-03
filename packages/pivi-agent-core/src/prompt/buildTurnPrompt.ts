import { appendBrowserContext } from '../context/browser';
import { appendCanvasContext } from '../context/canvas';
import { appendContextFiles, appendCurrentNote } from '../context/context';
import { appendEditorContext } from '../context/editor';
import { appendInlineContexts } from '../context/inlineContext';
import type { McpServerManager } from '../mcp';
import type { BuiltTurnPrompt, ChatTurnRequest } from './types';

function collectContextFilePaths(request: ChatTurnRequest): string[] {
  const paths = new Set<string>();

  for (const path of request.attachedFilePaths ?? []) {
    const trimmed = path.trim();
    if (trimmed) {
      paths.add(trimmed);
    }
  }

  for (const path of request.externalContextPaths ?? []) {
    const trimmed = path.trim();
    if (trimmed) {
      paths.add(trimmed);
    }
  }

  return [...paths];
}

/**
 * Merges Obsidian context (current note, selection, attachments) into the LLM prompt.
 * User-visible text stays in `request.text`; XML context tags are appended for the model.
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
    prompt: mcpManager.transformMentions(built.persistedContent),
    persistedContent: built.persistedContent,
    mcpMentions,
  };
}
