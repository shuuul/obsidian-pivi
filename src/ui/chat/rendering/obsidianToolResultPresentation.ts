import {
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { parseObsidianSearchHits } from '@pivi/pivi-agent-core/tools/toolPresentation';

function parseObsidianListEntries(result: string): unknown[] | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether the imperative expanded adapter has a compact structured result renderer. */
export function isObsidianToolCompactResult(name: string, result?: string): boolean {
  if (!result) return false;

  if (name === TOOL_OBSIDIAN_LIST || name === TOOL_OBSIDIAN_LIST_EXTERNAL) {
    return parseObsidianListEntries(result) !== null;
  }
  if (name !== TOOL_OBSIDIAN_SEARCH) return false;

  const hits = parseObsidianSearchHits(result);
  return hits.length > 0 && hits.length <= 12;
}
