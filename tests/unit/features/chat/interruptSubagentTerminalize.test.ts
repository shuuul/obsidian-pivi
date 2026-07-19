import { resolveSubagentActivityStatus } from '@pivi/pivi-agent-core/foundation';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { TOOL_SPAWN_AGENT } from '@pivi/pivi-agent-core/tools/toolNames';

import { terminalizeInterruptedSubagentToolCalls } from '@/ui/chat/controllers/inputTurnPipeline';

function assistantWithRunningSubagent(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Working…',
    timestamp: 1,
    toolCalls: [
      {
        id: 'spawn-1',
        name: TOOL_SPAWN_AGENT,
        input: { label: 'scan', run_in_background: true },
        status: 'running',
        isExpanded: false,
        subagent: {
          id: 'spawn-1',
          description: 'scan',
          mode: 'async',
          isExpanded: false,
          status: 'running',
          asyncStatus: 'running',
          activityStatus: 'running',
          toolCalls: [],
        },
      },
      {
        id: 'spawn-2',
        name: TOOL_SPAWN_AGENT,
        input: { label: 'buffered' },
        status: 'running',
        isExpanded: false,
      },
    ],
  };
}

describe('terminalizeInterruptedSubagentToolCalls', () => {
  it('marks running and buffered spawn cards cancelled after interrupt', () => {
    const message = assistantWithRunningSubagent();

    terminalizeInterruptedSubagentToolCalls(message);

    const withSubagent = message.toolCalls?.[0];
    const buffered = message.toolCalls?.[1];
    expect(withSubagent).toMatchObject({
      status: 'error',
      activityStatus: 'cancelled',
      result: 'Cancelled',
    });
    expect(withSubagent?.subagent).toMatchObject({
      status: 'error',
      asyncStatus: 'error',
      activityStatus: 'cancelled',
      result: 'Cancelled',
    });
    expect(resolveSubagentActivityStatus(withSubagent!.subagent!)).toBe('cancelled');
    expect(buffered).toMatchObject({
      status: 'error',
      activityStatus: 'cancelled',
      result: 'Cancelled',
    });
  });

  it('leaves already-terminal subagent cards unchanged', () => {
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'spawn-1',
        name: TOOL_SPAWN_AGENT,
        input: {},
        status: 'completed',
        isExpanded: false,
        result: 'Done',
        subagent: {
          id: 'spawn-1',
          description: 'done',
          mode: 'async',
          isExpanded: false,
          status: 'completed',
          asyncStatus: 'completed',
          activityStatus: 'completed',
          result: 'Done',
          toolCalls: [],
        },
      }],
    };

    terminalizeInterruptedSubagentToolCalls(message);

    expect(message.toolCalls?.[0]).toMatchObject({
      status: 'completed',
      result: 'Done',
      subagent: {
        status: 'completed',
        asyncStatus: 'completed',
        activityStatus: 'completed',
        result: 'Done',
      },
    });
  });
});
