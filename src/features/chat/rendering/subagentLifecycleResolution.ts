import { PiAgentServices } from '../../../core/agent/PiAgentServices';
import type { SubagentLifecycleAdapter } from '../../../core/agent/types';

/** Resolves the lifecycle adapter for the active Pi runtime. */
export function resolveSubagentLifecycleAdapter(
  toolName?: string,
): SubagentLifecycleAdapter | null {
  const activeAdapter = PiAgentServices.getSubagentLifecycleAdapter();

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
