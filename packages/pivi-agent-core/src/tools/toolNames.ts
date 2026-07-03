import { TOOL_OBSIDIAN_EDIT } from './obsidianToolNames';

export const TOOL_AGENT_OUTPUT = 'TaskOutput' as const;
export const TOOL_ASK_USER_QUESTION = 'AskUserQuestion' as const;
export const TOOL_BASH = 'Bash' as const;
export const TOOL_BASH_OUTPUT = 'BashOutput' as const;
export const TOOL_EDIT = 'Edit' as const;
export const TOOL_GLOB = 'Glob' as const;
export const TOOL_GREP = 'Grep' as const;
export const TOOL_KILL_SHELL = 'KillShell' as const;
export const TOOL_LS = 'LS' as const;
export const TOOL_LIST_MCP_RESOURCES = 'ListMcpResources' as const;
export const TOOL_MCP = 'Mcp' as const;
export const TOOL_NOTEBOOK_EDIT = 'NotebookEdit' as const;
export const TOOL_READ = 'Read' as const;
export const TOOL_READ_MCP_RESOURCE = 'ReadMcpResource' as const;
export const TOOL_SKILL = 'skill' as const;
export const TOOL_SUBAGENT = 'Agent' as const;
export const TOOL_SUBAGENT_LEGACY = 'Task' as const;
// Kept as an alias while the internal codebase is still named around "Task".
export const TOOL_TASK = TOOL_SUBAGENT;
export const TOOL_TODO_WRITE = 'TodoWrite' as const;
export const TOOL_TOOL_SEARCH = 'ToolSearch' as const;
export const TOOL_WEB_FETCH = 'WebFetch' as const;
export const TOOL_WEB_SEARCH = 'WebSearch' as const;
export const TOOL_WRITE = 'Write' as const;

// Runtime-managed tools exposed through provider adapters.
export const TOOL_APPLY_PATCH = 'apply_patch' as const;
export const TOOL_WRITE_STDIN = 'write_stdin' as const;
export const TOOL_SPAWN_AGENT = 'spawn_agent' as const;
export const TOOL_SEND_INPUT = 'send_input' as const;
export const TOOL_WAIT = 'wait' as const;
export const TOOL_WAIT_AGENT = 'wait_agent' as const;
export const TOOL_RESUME_AGENT = 'resume_agent' as const;
export const TOOL_CLOSE_AGENT = 'close_agent' as const;

export const AGENT_LIFECYCLE_TOOLS = [
  TOOL_SPAWN_AGENT,
  TOOL_SEND_INPUT,
  TOOL_WAIT,
  TOOL_WAIT_AGENT,
  TOOL_RESUME_AGENT,
  TOOL_CLOSE_AGENT,
] as const;

export function isAgentLifecycleTool(name: string): boolean {
  return (AGENT_LIFECYCLE_TOOLS as readonly string[]).includes(name);
}

// These tools resolve via dedicated callbacks (not content-based), so their
// tool_result should never be marked "blocked" based on result text.
export const TOOLS_SKIP_BLOCKED_DETECTION = [
  TOOL_ASK_USER_QUESTION,
] as const;

export const SUBAGENT_TOOL_NAMES = [
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
] as const;
export type SubagentToolName = (typeof SUBAGENT_TOOL_NAMES)[number];

export function skipsBlockedDetection(name: string): boolean {
  return (TOOLS_SKIP_BLOCKED_DETECTION as readonly string[]).includes(name);
}

export function isSubagentToolName(name: string): name is SubagentToolName {
  return (SUBAGENT_TOOL_NAMES as readonly string[]).includes(name);
}

export const EDIT_TOOLS = [TOOL_WRITE, TOOL_EDIT, TOOL_NOTEBOOK_EDIT] as const;
export type EditToolName = (typeof EDIT_TOOLS)[number];

export const WRITE_EDIT_TOOLS = [TOOL_WRITE, TOOL_EDIT, TOOL_OBSIDIAN_EDIT] as const;
export type WriteEditToolName = (typeof WRITE_EDIT_TOOLS)[number];

export function isEditTool(toolName: string): toolName is EditToolName {
  return (EDIT_TOOLS as readonly string[]).includes(toolName);
}

export function isWriteEditTool(toolName: string): toolName is WriteEditToolName {
  return (WRITE_EDIT_TOOLS as readonly string[]).includes(toolName);
}
