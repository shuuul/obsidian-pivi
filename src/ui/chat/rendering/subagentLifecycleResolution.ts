import type { SubagentLifecycleAdapter } from '@pivi/obsidian-tools';

export function resolveSubagentLifecycleAdapter(
  toolName?: string,
  activeAdapter: SubagentLifecycleAdapter | null = null,
): SubagentLifecycleAdapter | null {
  if (!toolName) {
    return activeAdapter;
  }

  return activeAdapter && adapterOwnsTool(activeAdapter, toolName) ? activeAdapter : null;
}

function adapterOwnsTool(adapter: SubagentLifecycleAdapter, toolName: string): boolean {
  return adapter.isSpawnTool(toolName)
    || adapter.isHiddenTool(toolName)
    || adapter.isWaitTool(toolName)
    || adapter.isCloseTool(toolName);
}
