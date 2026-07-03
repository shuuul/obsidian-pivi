/** Obsidian-native agent tools (ADR-0009). */
export const TOOL_OBSIDIAN_READ = 'obsidian_read' as const;
export const TOOL_OBSIDIAN_EDIT = 'obsidian_edit' as const;
export const TOOL_OBSIDIAN_WRITE = 'obsidian_write' as const;
export const TOOL_OBSIDIAN_SEARCH = 'obsidian_search' as const;
export const TOOL_OBSIDIAN_NOTE_INFO = 'obsidian_note_info' as const;
export const TOOL_OBSIDIAN_LINKS = 'obsidian_links' as const;
export const TOOL_OBSIDIAN_PROPERTIES = 'obsidian_properties' as const;
export const TOOL_OBSIDIAN_TASKS = 'obsidian_tasks' as const;
export const TOOL_OBSIDIAN_HISTORY = 'obsidian_history' as const;
export const TOOL_OBSIDIAN_DELETE = 'obsidian_delete' as const;
export const TOOL_OBSIDIAN_MOVE = 'obsidian_move' as const;
export const TOOL_OBSIDIAN_LIST = 'obsidian_list' as const;
export const TOOL_OBSIDIAN_MKDIR = 'obsidian_mkdir' as const;
export const TOOL_OBSIDIAN_OPEN = 'obsidian_open' as const;
export const TOOL_OBSIDIAN_ATTACHMENT = 'obsidian_attachment' as const;
export const TOOL_OBSIDIAN_GENERATE_IMAGE = 'obsidian_generate_image' as const;
export const TOOL_OBSIDIAN_COMMAND = 'obsidian_command' as const;
export const TOOL_OBSIDIAN_EVAL = 'obsidian_eval' as const;

export const OBSIDIAN_AGENT_TOOLS = [
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_WRITE,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
] as const;

export const OBSIDIAN_OPTIONAL_TOOLS = [
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
] as const;

const ALL_OBSIDIAN_TOOLS = [...OBSIDIAN_AGENT_TOOLS, ...OBSIDIAN_OPTIONAL_TOOLS] as const;

export function isObsidianAgentTool(name: string): boolean {
  return (ALL_OBSIDIAN_TOOLS as readonly string[]).includes(name);
}
