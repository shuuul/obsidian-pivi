/** Obsidian-native agent tools (ADR-0009). */
export const TOOL_OBSIDIAN_READ = 'obsidian_read' as const;
export const TOOL_OBSIDIAN_WRITE = 'obsidian_write' as const;
export const TOOL_OBSIDIAN_SEARCH = 'obsidian_search' as const;
export const TOOL_OBSIDIAN_NOTE_INFO = 'obsidian_note_info' as const;
export const TOOL_OBSIDIAN_LINKS = 'obsidian_links' as const;
export const TOOL_OBSIDIAN_PROPERTIES = 'obsidian_properties' as const;
export const TOOL_OBSIDIAN_TASKS = 'obsidian_tasks' as const;
export const TOOL_OBSIDIAN_COMMAND = 'obsidian_command' as const;
export const TOOL_OBSIDIAN_EVAL = 'obsidian_eval' as const;

export const OBSIDIAN_AGENT_TOOLS = [
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_WRITE,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
] as const;

export const OBSIDIAN_OPTIONAL_TOOLS = [
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
] as const;

export const OBSIDIAN_MUTATING_TOOLS = [
  TOOL_OBSIDIAN_WRITE,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
] as const;

export function isObsidianMutatingTool(name: string): boolean {
  return (OBSIDIAN_MUTATING_TOOLS as readonly string[]).includes(name);
}
