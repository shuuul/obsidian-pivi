import type { SubagentLifecycleAdapter } from '@pivi/pivi-agent-core/tools';
import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation/tools';
import { applySubagentLifecycleToolResult } from '@/ui/chat/stream/SubagentEventPresenter';

describe('applySubagentLifecycleToolResult', () => {
  const adapter: SubagentLifecycleAdapter = {
    isHiddenTool: () => false,
    isSpawnTool: (name) => name === 'Agent',
    isWaitTool: (name) => name === 'AgentOutput',
    isCloseTool: () => false,
    resolveSpawnToolIds: () => ['spawn-1'],
    buildSubagentInfo: () => ({
      id: 'sub-1',
      description: 'desc',
      isExpanded: false,
      status: 'completed',
      toolCalls: [],
      result: 'done',
    }),
    extractSpawnResult: () => ({ agentId: 'agent-42' }),
    extractWaitResult: () => ({ statuses: {}, timedOut: false }),
  };

  it('updates spawn tool and returns agent id mapping', () => {
    const toolCall: ToolCallInfo = {
      id: 'spawn-1',
      name: 'Agent',
      input: {},
      status: 'running',
    };

    const update = applySubagentLifecycleToolResult(
      toolCall,
      { id: 'spawn-1', content: '{"agentId":"agent-42"}' },
      '{"agentId":"agent-42"}',
      adapter,
      new Map(),
    );

    expect(update).toEqual({
      kind: 'spawn',
      spawnToolId: 'spawn-1',
      agentId: 'agent-42',
      normalizedContent: '{"agentId":"agent-42"}',
      isError: false,
    });
    expect(toolCall.status).toBe('completed');
  });

  it('returns wait spawn ids from adapter', () => {
    const toolCall: ToolCallInfo = {
      id: 'wait-1',
      name: 'AgentOutput',
      input: {},
      status: 'running',
    };

    const update = applySubagentLifecycleToolResult(
      toolCall,
      { id: 'wait-1', content: 'ok' },
      'ok',
      adapter,
      new Map([['agent-42', 'spawn-1']]),
    );

    expect(update).toMatchObject({
      kind: 'wait',
      waitToolId: 'wait-1',
      spawnToolIds: ['spawn-1'],
    });
  });
});
