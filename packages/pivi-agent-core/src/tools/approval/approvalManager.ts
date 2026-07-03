/** Permission utilities for tool action approval. */

import {
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../obsidianToolNames';
import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_WRITE,
} from '../toolNames';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function getActionPattern(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case TOOL_BASH:
      return typeof input.command === 'string' ? input.command.trim() : '';
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT:
      return typeof input.file_path === 'string' && input.file_path ? input.file_path : null;
    case TOOL_NOTEBOOK_EDIT:
      if (typeof input.notebook_path === 'string' && input.notebook_path) {
        return input.notebook_path;
      }
      return typeof input.file_path === 'string' && input.file_path ? input.file_path : null;
    case TOOL_GLOB:
      return typeof input.pattern === 'string' && input.pattern ? input.pattern : null;
    case TOOL_GREP:
      return typeof input.pattern === 'string' && input.pattern ? input.pattern : null;
    case TOOL_OBSIDIAN_EDIT:
    case TOOL_OBSIDIAN_WRITE:
    case TOOL_OBSIDIAN_DELETE:
    case TOOL_OBSIDIAN_MKDIR:
      return typeof input.path === 'string' && input.path
        ? input.path
        : typeof input.file === 'string'
          ? input.file
          : null;
    case TOOL_OBSIDIAN_MOVE:
      return typeof input.path === 'string' && input.path ? input.path : null;
    case TOOL_OBSIDIAN_PROPERTIES:
    case TOOL_OBSIDIAN_TASKS:
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return typeof input.path === 'string' && input.path
        ? input.path
        : typeof input.file === 'string'
          ? input.file
          : (optionalString(input.insertInto) ?? optionalString(input.sourcePath) ?? optionalString(input.filename) ?? optionalString(input.action) ?? '');
    case TOOL_OBSIDIAN_COMMAND:
      return typeof input.id === 'string' ? input.id : null;
    case TOOL_OBSIDIAN_EVAL:
      return typeof input.code === 'string' ? input.code.slice(0, 80) : null;
    default:
      return JSON.stringify(input);
  }
}

export function getActionDescription(toolName: string, input: Record<string, unknown>): string {
  const pattern = getActionPattern(toolName, input) ?? '(unknown)';
  switch (toolName) {
    case TOOL_BASH:
      return `Run command: ${pattern}`;
    case TOOL_READ:
      return `Read file: ${pattern}`;
    case TOOL_WRITE:
      return `Write to file: ${pattern}`;
    case TOOL_EDIT:
      return `Edit file: ${pattern}`;
    case TOOL_GLOB:
      return `Search files matching: ${pattern}`;
    case TOOL_GREP:
      return `Search content matching: ${pattern}`;
    case TOOL_OBSIDIAN_EDIT:
      return `Obsidian edit: ${pattern}`;
    case TOOL_OBSIDIAN_WRITE:
      return `Obsidian write (${optionalString(input.mode) ?? 'write'}): ${pattern}`;
    case TOOL_OBSIDIAN_DELETE:
      return `Obsidian trash: ${pattern}`;
    case TOOL_OBSIDIAN_MOVE:
      return `Obsidian move: ${pattern} -> ${optionalString(input.newPath) ?? '(unknown)'}`;
    case TOOL_OBSIDIAN_MKDIR:
      return `Obsidian create folder: ${pattern}`;
    case TOOL_OBSIDIAN_PROPERTIES:
      return `Obsidian properties ${optionalString(input.action) ?? ''}: ${pattern}`;
    case TOOL_OBSIDIAN_TASKS:
      return `Obsidian tasks ${optionalString(input.action) ?? ''}: ${pattern}`;
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return `Obsidian generate image: ${pattern}`;
    case TOOL_OBSIDIAN_COMMAND:
      return `Obsidian command: ${pattern}`;
    case TOOL_OBSIDIAN_EVAL:
      return `Obsidian eval: ${pattern}`;
    default:
      return `${toolName}: ${pattern}`;
  }
}

/**
 * Bash: exact or explicit wildcard ("git *", "npm:*").
 * File tools: path-prefix matching with segment boundaries.
 * Other tools: simple prefix matching.
 */
export function matchesRulePattern(
  toolName: string,
  actionPattern: string | null,
  rulePattern: string | undefined
): boolean {
  // No rule pattern means match all
  if (!rulePattern) return true;

  // Null action pattern means we can't determine the action - don't match
  if (actionPattern === null) return false;

  const normalizedAction = actionPattern.replace(/\\/g, '/');
  const normalizedRule = rulePattern.replace(/\\/g, '/');

  // Wildcard matches everything
  if (normalizedRule === '*') return true;

  // Exact match
  if (normalizedAction === normalizedRule) return true;

  // Bash: Only exact match (handled above) or explicit wildcard patterns are allowed.
  // This is intentional - Bash commands require explicit wildcards for security.
  // Supported formats:
  //   - "git *" matches "git status", "git commit", etc.
  //   - "npm:*" matches "npm install", "npm run", etc. (CC format)
  if (toolName === TOOL_BASH) {
    // CC format "npm:*" — colon is a separator, not part of the prefix
    if (normalizedRule.endsWith(':*')) {
      const prefix = normalizedRule.slice(0, -2);
      return matchesBashPrefix(normalizedAction, prefix);
    }
    // Space wildcard "git *"
    if (normalizedRule.endsWith('*')) {
      const prefix = normalizedRule.slice(0, -1);
      return matchesBashPrefix(normalizedAction, prefix);
    }
    // No wildcard present and exact match failed above - reject
    return false;
  }

  // File tools and vault path tools: prefix match with path-segment boundary awareness
  if (
    toolName === TOOL_READ ||
    toolName === TOOL_WRITE ||
    toolName === TOOL_EDIT ||
    toolName === TOOL_NOTEBOOK_EDIT ||
    toolName === TOOL_OBSIDIAN_EDIT ||
    toolName === TOOL_OBSIDIAN_WRITE ||
    toolName === TOOL_OBSIDIAN_DELETE ||
    toolName === TOOL_OBSIDIAN_MOVE ||
    toolName === TOOL_OBSIDIAN_MKDIR ||
    toolName === TOOL_OBSIDIAN_GENERATE_IMAGE ||
    toolName === TOOL_OBSIDIAN_PROPERTIES ||
    toolName === TOOL_OBSIDIAN_TASKS
  ) {
    return isPathPrefixMatch(normalizedAction, normalizedRule);
  }

  // Other tools: allow simple prefix matching
  if (normalizedAction.startsWith(normalizedRule)) return true;

  return false;
}

function isPathPrefixMatch(actionPath: string, approvedPath: string): boolean {
  if (!actionPath.startsWith(approvedPath)) {
    return false;
  }

  if (approvedPath.endsWith('/')) {
    return true;
  }

  if (actionPath.length === approvedPath.length) {
    return true;
  }

  return actionPath.charAt(approvedPath.length) === '/';
}

function matchesBashPrefix(action: string, prefix: string): boolean {
  if (action === prefix) {
    return true;
  }

  if (prefix.endsWith(' ')) {
    return action.startsWith(prefix);
  }

  return action.startsWith(`${prefix} `);
}
