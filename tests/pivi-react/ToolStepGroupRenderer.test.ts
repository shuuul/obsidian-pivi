import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { TOOL_BASH } from '@pivi/pivi-agent-core/tools/toolNames';

import { createToolStepGroup } from '@/ui/chat/rendering/ToolStepGroupRenderer';

function toolCall(
  id: string,
  status: ToolCallInfo['status'],
  command: string,
): ToolCallInfo {
  return { id, input: { command }, name: TOOL_BASH, status };
}

describe('imperative tool step group status counts', () => {
  it('renders and updates separate completed and failed counts', () => {
    const parent = document.createElement('div');
    const completed = toolCall('bash-1', 'completed', 'pwd');
    const failed = toolCall('bash-2', 'error', 'false');
    const state = createToolStepGroup(parent, [completed, failed]);

    expect(state.statusEl).toHaveTextContent('1 Completed/1 Failed');
    expect(state.statusEl).toHaveAttribute('aria-label', '1 Completed / 1 Failed');
    expect(state.statusEl.querySelector('.status-completed')).not.toBeNull();
    expect(state.statusEl.querySelector('.status-failed')).not.toBeNull();

    state.updateToolCall(failed.id, { ...failed, status: 'completed' });

    expect(state.statusEl).toHaveTextContent('2 Completed');
    expect(state.statusEl.querySelectorAll('.pivi-tool-status')).toHaveLength(1);
  });
});
