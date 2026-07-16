import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { deriveAgentRunEntities } from '@pivi/pivi-react/store';

describe('Agent-run projection', () => {
  it('ignores tools without a delegated Agent run', () => {
    expect(deriveAgentRunEntities({
      id: 'read-1',
      name: 'read',
      input: {},
      status: 'completed',
    }, 'assistant-1', null)).toEqual([]);
  });

  it('derives nested ownership, lifecycle, timing, usage, and terminal references', () => {
    const tool: ToolCallInfo = {
      id: 'spawn-parent',
      name: 'spawn_agent',
      input: {},
      status: 'running',
      startedAt: 10,
      toolUseResult: {
        agent_report: {
          schemaVersion: 1,
          objective: 'Coordinate research',
          outcome: 'completed',
          summary: 'Coordination complete.',
        },
      },
      subagent: {
        id: 'parent-run',
        agentId: 'parent-runtime',
        writerName: 'coordinator',
        description: 'Coordinate research',
        prompt: 'Research the topic',
        isExpanded: false,
        mode: 'async',
        status: 'running',
        activityStatus: 'waiting',
        startedAt: 12,
        toolCalls: [{
          id: 'read-complete',
          name: 'read',
          input: {},
          status: 'completed',
        }, {
          id: 'read-active',
          name: 'read',
          input: {},
          status: 'running',
        }, {
          id: 'spawn-child',
          name: 'spawn_agent',
          input: {},
          status: 'completed',
          startedAt: 20,
          completedAt: 31,
          subagent: {
            id: 'child-run',
            agentId: 'child-runtime',
            description: 'Verify sources',
            isExpanded: false,
            status: 'completed',
            result: 'Verified.\n```pivi-agent-report\n{"schemaVersion":1,"objective":"Verify sources","outcome":"completed","summary":"Sources verified."}\n```',
            outputToolId: 'child-output',
            toolCalls: [],
            usage: { contextTokens: 140, inputTokens: 120, outputTokens: 20 },
          },
        }],
      },
    };

    const [parent, child] = deriveAgentRunEntities(tool, 'assistant-1', null);

    expect(parent).toMatchObject({
      id: 'parent-run',
      runId: 'parent-run',
      agentId: 'parent-runtime',
      messageId: 'assistant-1',
      owningMessageId: 'assistant-1',
      owningToolId: 'spawn-parent',
      parentRunId: null,
      childRunIds: ['child-run'],
      currentActivity: {
        status: 'running',
        toolId: 'read-active',
        toolName: 'read',
      },
      mode: 'async',
      prompt: 'Research the topic',
      startedAt: 12,
      status: 'waiting',
      toolIds: ['read-complete', 'read-active', 'spawn-child'],
      usage: null,
      writerName: 'coordinator',
      report: {
        schemaVersion: 1,
        objective: 'Coordinate research',
        outcome: 'completed',
        summary: 'Coordination complete.',
      },
    });
    expect(parent).not.toHaveProperty('completedAt');
    expect(parent).not.toHaveProperty('terminalResult');

    expect(child).toMatchObject({
      id: 'child-run',
      runId: 'child-run',
      agentId: 'child-runtime',
      messageId: 'assistant-1',
      owningMessageId: 'assistant-1',
      owningToolId: 'spawn-child',
      parentRunId: 'parent-run',
      childRunIds: [],
      mode: 'sync',
      startedAt: 20,
      completedAt: 31,
      status: 'completed',
      terminalResult: {
        outputToolId: 'child-output',
        text: expect.stringContaining('Verified.'),
      },
      toolIds: [],
      usage: { contextTokens: 140, inputTokens: 120, outputTokens: 20 },
      report: {
        schemaVersion: 1,
        objective: 'Verify sources',
        outcome: 'completed',
        summary: 'Sources verified.',
      },
    });
  });

  it('keeps the persisted spawn-run identity when the runtime Agent id arrives', () => {
    const createTool = (agentId?: string): ToolCallInfo => ({
      id: 'spawn-1',
      name: 'spawn_agent',
      input: {},
      status: 'running',
      subagent: {
        id: 'stable-run',
        ...(agentId ? { agentId } : {}),
        description: 'Research',
        isExpanded: false,
        status: 'running',
        toolCalls: [],
      },
    });

    const [before] = deriveAgentRunEntities(createTool(), 'assistant-1', null);
    const [after] = deriveAgentRunEntities(createTool('runtime-agent'), 'assistant-1', null);

    expect(before?.id).toBe('stable-run');
    expect(after?.id).toBe('stable-run');
    expect(after?.runId).toBe(before?.runId);
    expect(after?.agentId).toBe('runtime-agent');
  });
});
