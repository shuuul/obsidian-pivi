import type { PiSubagentQueryRunner } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import { createSubagentTool } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';

const CONTEXT_BATCH_PROMPT = 'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent uses stable sub-agent labels to avoid context cross-contamination.';

describe('createSubagentTool', () => {
  function createRunner(
    impl?: PiSubagentQueryRunner['query'],
  ): { runner: PiSubagentQueryRunner; query: jest.Mock } {
    const query = jest.fn(
      impl ??
        (async (_options: { systemPrompt: string }, _prompt: string) => 'subagent answer'),
    );
    return { runner: { query }, query };
  }

  it('trims prompt, builds system prompt with Task line, calls runner, returns text result', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    const result = await tool.execute('call-1', {
      description: 'Summarize notes',
      message: '  do the work  ',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      {
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          'Task: Summarize notes',
          CONTEXT_BATCH_PROMPT,
          'Return a concise final answer only.',
        ].join('\n'),
      },
      'do the work',
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'subagent answer' }],
      details: {},
    });
  });

  it('throws when message is empty or whitespace after trimming', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await expect(tool.execute('call-2', { message: '' })).rejects.toThrow('message is required');
    await expect(tool.execute('call-3', { message: '   \n\t  ' })).rejects.toThrow(
      'message is required',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects compact commands because subagents must never compact context', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await expect(tool.execute('call-compact', { message: '/compact summarize' })).rejects.toThrow(
      'Subagents cannot run context compaction',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('starts a background subagent when run_in_background is true', async () => {
    const spawn = jest.fn(async () => ({ agentId: 'subagent-1' }));
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn,
    };
    const tool = createSubagentTool(runner);

    const result = await tool.execute('call-4', { message: 'go', run_in_background: true });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-4' }),
      'go',
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ agent_id: 'subagent-1', status: 'running' }) }],
      details: { agent_id: 'subagent-1', status: 'running' },
    });
  });

  it('returns the completed background result when the runner can wait for it', async () => {
    const spawn = jest.fn(async () => ({ agentId: 'subagent-1' }));
    const waitForResult = jest.fn(async () => ({
      status: 'completed' as const,
      result: 'final subagent report',
    }));
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn,
      waitForResult,
    };
    const tool = createSubagentTool(runner);

    const result = await tool.execute('call-4b', { message: 'go', run_in_background: true });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-4b' }),
      'go',
    );
    expect(waitForResult).toHaveBeenCalledWith('subagent-1');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'final subagent report' }],
      details: {
        agent_id: 'subagent-1',
        status: 'completed',
        result: 'final subagent report',
      },
    });
  });

  it('omits Task line from system prompt when description is omitted', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await tool.execute('call-5', { prompt: 'only prompt' });

    expect(query).toHaveBeenCalledWith(
      {
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          CONTEXT_BATCH_PROMPT,
          'Return a concise final answer only.',
        ].join('\n'),
      },
      'only prompt',
    );
  });
});
