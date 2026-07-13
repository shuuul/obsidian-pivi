import type { PiSubagentQueryRunner } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import { createSubagentTool } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';

const CONTEXT_BATCH_PROMPT = 'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent keeps each spawn_agent call isolated to avoid context cross-contamination.';
const RESPONSE_LANGUAGE_PROMPT = 'Reply in the same language as the task prompt/instructions you received.';
const LAUNCH = {
  agentId: 'subagent-1',
  maxConcurrentSubagents: 3,
  queuePosition: null,
  queued: false,
  runningAtRequest: 0,
  runningAtStart: 1,
};

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
      label: 'Summarize notes',
      message: '  do the work  ',
      run_in_background: false,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      {
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          'Task: Summarize notes',
          CONTEXT_BATCH_PROMPT,
          RESPONSE_LANGUAGE_PROMPT,
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
    const spawn = jest.fn(async () => LAUNCH);
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

    const result = await tool.execute('call-4', { message: 'go', run_in_background: true });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-4' }),
      'go',
    );
    expect(waitForResult).toHaveBeenCalledWith('subagent-1');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Launch concurrency: 1/3.\n\nBackground sub-agent subagent-1 completed.\n\nfinal subagent report' }],
      details: {
        agent_id: 'subagent-1',
        concurrency: {
          max_concurrent_subagents: 3,
          queue_position: null,
          queued: false,
          running_at_request: 0,
          running_at_start: 1,
        },
        status: 'completed',
        result: 'final subagent report',
      },
    });
  });

  it('defaults legacy omitted run_in_background calls to background execution', async () => {
    const spawn = jest.fn(async () => LAUNCH);
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn,
      waitForResult: jest.fn(async () => ({ status: 'completed' as const, result: 'done' })),
    };
    const tool = createSubagentTool(runner);

    await tool.execute('legacy-call', { label: 'legacy', message: 'go' });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('waits for background work so the main agent receives the final report', async () => {
    const spawn = jest.fn(async () => LAUNCH);
    const waitForResult = jest.fn(async () => ({
      status: 'error' as const,
      result: 'subagent failed',
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
      content: [{ type: 'text', text: 'Launch concurrency: 1/3.\n\nBackground sub-agent subagent-1 failed.\n\nsubagent failed' }],
      details: {
        agent_id: 'subagent-1',
        concurrency: {
          max_concurrent_subagents: 3,
          queue_position: null,
          queued: false,
          running_at_request: 0,
          running_at_start: 1,
        },
        status: 'error',
        result: 'subagent failed',
      },
    });
  });

  it('requires awaitable background subagents', async () => {
    const spawn = jest.fn(async () => LAUNCH);
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn,
    };
    const tool = createSubagentTool(runner);

    await expect(tool.execute('call-4c', { message: 'go', run_in_background: true }))
      .rejects.toThrow('Background sub-agents cannot be awaited');
  });

  it('tells the model when a spawn exceeded capacity and waited in FIFO order', async () => {
    const spawn = jest.fn(async () => ({
      ...LAUNCH,
      queuePosition: 4,
      queued: true,
      runningAtRequest: 3,
      runningAtStart: 3,
    }));
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn,
      waitForResult: jest.fn(async () => ({ status: 'completed' as const, result: 'done' })),
    };
    const tool = createSubagentTool(runner, { maxConcurrentSubagents: 3 });

    const result = await tool.execute('queued-call', {
      label: 'queued',
      message: 'go',
      run_in_background: true,
    });

    expect(result.content[0]).toEqual(expect.objectContaining({
      text: expect.stringContaining('Concurrency limit exceeded at request time (3/3 running)'),
    }));
    expect(result.content[0]).toEqual(expect.objectContaining({
      text: expect.stringContaining('FIFO queue position 4'),
    }));
    expect(result.details).toEqual(expect.objectContaining({
      concurrency: expect.objectContaining({ queued: true, queue_position: 4 }),
    }));
  });

  it('publishes the configured plugin-wide concurrency limit in the tool description', () => {
    const { runner } = createRunner();
    const tool = createSubagentTool(runner, { maxConcurrentSubagents: 8 });

    expect(tool.description).toContain('At most 8 background sub-agents');
    expect(tool.description).toContain('shared across tabs');
    expect(tool.description).toContain('same assistant response');
    expect(tool.description).toContain('FIFO');
    expect(tool.executionMode).toBe('parallel');
  });

  it('requires the canonical label, message, and execution mode parameters', () => {
    const { runner } = createRunner();
    const tool = createSubagentTool(runner);
    const parameters = tool.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(parameters).toMatchObject({
      required: ['label', 'message', 'run_in_background'],
      properties: {
        label: expect.any(Object),
        message: expect.any(Object),
        run_in_background: expect.any(Object),
      },
    });
    expect(parameters.properties).not.toHaveProperty('description');
    expect(parameters.properties).not.toHaveProperty('prompt');
  });
});
