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

function requestsSubagentDelegation(text: string): boolean {
  return /\bsub[-_ ]?agents?\b|\bspawn_agent\b/i.test(text);
}

function isLikelyMultiContextDelegationCandidate(contextFiles: readonly string[]): boolean {
  return contextFiles.length > 1;
}

function appendSubagentDelegationPolicy(prompt: string, explicitRequest: boolean): string {
  const trigger = explicitRequest
    ? 'The user asked for sub-agent delegation.'
    : 'Multiple attached context files may represent distinct context groups for the same task.';
  const automaticGuidance = explicitRequest
    ? ''
    : ' If the task is complex enough to require substantive analysis, comparison, extraction, or transformation across those groups, automatically spawn sub-agents instead of reading every group in the main session. For simple lookups or tiny context, direct main-agent reads are acceptable.';

  return `${prompt}\n\n<subagent_delegation_policy>\n${trigger} Treat attached context_files as delegation candidates, not as files the main agent should inspect first.${automaticGuidance} If a file or group of files is assigned to a sub-agent, the main agent must not call obsidian_read, obsidian_markdown_structure, obsidian_search, or stats on that delegated context before the sub-agent reports back. Assign stable, non-overlapping context batches; keep later work on the same batch with the same sub-agent label/purpose; do not split one batch across multiple sub-agents or mix unrelated batches in one sub-agent. The main agent should synthesize from sub-agent reports instead of importing delegated file contents into the main session.\n</subagent_delegation_policy>`;
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
    const explicitSubagentRequest = requestsSubagentDelegation(request.text);
    if (explicitSubagentRequest || isLikelyMultiContextDelegationCandidate(contextFiles)) {
      prompt = appendSubagentDelegationPolicy(prompt, explicitSubagentRequest);
    }
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
