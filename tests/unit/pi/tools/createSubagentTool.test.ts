import type { PiSubagentQueryRunner } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import { createSubagentTool } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import { formatAgentReportBlock } from '@pivi/pivi-agent-core/session/continuationSchemas';

const CONTEXT_BATCH_PROMPT = 'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent keeps each spawn_agent call isolated to avoid context cross-contamination.';
const RESPONSE_LANGUAGE_PROMPT = 'Reply in the same language as the task prompt/instructions you received.';
const REPORT_PROMPT = 'Return a concise final answer, then end with exactly one fenced pivi-agent-report JSON block.';
const REPORT_SCHEMA_PROMPT = 'The JSON object must use schemaVersion 1, objective, outcome (completed, failed, cancelled, or orphaned), and may include summary, findings, decisions, artifacts, and openQuestions. Artifacts use {"label":"...","vaultPath":"vault/relative/path"}; never include an absolute device path.';
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
      expect.objectContaining({
        abortController: expect.any(AbortController),
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          'Task: Summarize notes',
          CONTEXT_BATCH_PROMPT,
          RESPONSE_LANGUAGE_PROMPT,
          REPORT_PROMPT,
          REPORT_SCHEMA_PROMPT,
        ].join('\n'),
      }),
      'do the work',
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'subagent answer' }],
      details: {},
    });
  });

  it('returns a compact structured report to the parent while preserving blocking terminal text', async () => {
    const report = {
      schemaVersion: 1 as const,
      objective: 'Audit notes',
      outcome: 'failed' as const,
      summary: 'Found the relevant notes.',
      findings: ['One finding'],
    };
    const terminal = `Narrative detail.\n${formatAgentReportBlock(report)}`;
    const { runner } = createRunner(async () => terminal);
    const tool = createSubagentTool(runner);

    const result = await tool.execute('structured-blocking', {
      label: 'Audit',
      message: 'audit notes',
      run_in_background: false,
    });

    const parentText = (result.content[0] as { text?: string } | undefined)?.text ?? '';
    expect(parentText).toContain('Agent report objective: Audit notes');
    expect(parentText).toContain('Outcome: completed');
    expect(parentText).not.toContain('Narrative detail.');
    expect(result.details).toEqual({
      agent_report: { ...report, outcome: 'completed' },
      terminal_result: terminal,
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

  it('compacts a valid background report and preserves its raw result details', async () => {
    const report = {
      schemaVersion: 1 as const,
      objective: 'Inspect cards',
      outcome: 'completed' as const,
      decisions: ['Use the first card'],
    };
    const terminal = `Full terminal narrative.\n${formatAgentReportBlock(report)}`;
    const runner: PiSubagentQueryRunner = {
      query: jest.fn(),
      spawn: jest.fn(async () => LAUNCH),
      waitForResult: jest.fn(async () => ({ status: 'completed' as const, result: terminal })),
    };
    const tool = createSubagentTool(runner);

    const result = await tool.execute('structured-background', {
      label: 'Inspect',
      message: 'inspect cards',
      run_in_background: true,
    });

    const parentText = (result.content[0] as { text?: string } | undefined)?.text ?? '';
    expect(parentText).toContain('Agent report objective: Inspect cards');
    expect(parentText).not.toContain('Full terminal narrative.');
    expect(result.details).toMatchObject({
      result: terminal,
      agent_report: report,
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

  it('propagates cancellation through a blocking subagent query', async () => {
    const query = jest.fn((options: { abortController?: AbortController }) => (
      new Promise<string>((_resolve, reject) => {
        options.abortController?.signal.addEventListener('abort', () => reject(new Error('Cancelled')));
      })
    ));
    const tool = createSubagentTool({ query });
    const controller = new AbortController();

    const execution = tool.execute('blocking-cancel', {
      label: 'blocking',
      message: 'wait',
      run_in_background: false,
    }, controller.signal);
    controller.abort();

    await expect(execution).rejects.toThrow('Cancelled');
    expect(query.mock.calls[0]?.[0].abortController?.signal.aborted).toBe(true);
  });

  it('keeps background cancellation connected while awaiting the result', async () => {
    let launchController: AbortController | undefined;
    const spawn = jest.fn(async (options: { abortController?: AbortController }) => {
      launchController = options.abortController;
      return LAUNCH;
    });
    const waitForResult = jest.fn(() => new Promise<{ status: 'error'; result: string }>((resolve) => {
      launchController?.signal.addEventListener('abort', () => {
        resolve({ status: 'error', result: 'Cancelled' });
      });
    }));
    const tool = createSubagentTool({ query: jest.fn(), spawn, waitForResult });
    const controller = new AbortController();

    const execution = tool.execute('background-cancel', {
      label: 'background',
      message: 'wait',
      run_in_background: true,
    }, controller.signal);
    await Promise.resolve();
    controller.abort();

    const result = await execution;
    expect(launchController?.signal.aborted).toBe(true);
    expect(result.details).toMatchObject({
      status: 'error',
      activity_status: 'cancelled',
      result: 'Cancelled',
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
    expect(tool.description).toContain('asks for, allows, or says you can/may use them');
    expect(tool.description).toContain('create 8 balanced non-overlapping batches');
    expect(tool.description).toContain('Do not spawn one worker and wait');
    expect(tool.description).toContain('FIFO');
    expect(tool.executionMode).toBe('parallel');
  });

  it('allows a same-response batch to launch up to the configured maximum concurrently', async () => {
    const completions = new Map<string, (result: { status: 'completed'; result: string }) => void>();
    let launchCount = 0;
    const spawn = jest.fn(async (_options: unknown, prompt: string) => ({
      ...LAUNCH,
      agentId: `subagent-${prompt}`,
      runningAtStart: ++launchCount,
    }));
    const waitForResult = jest.fn((agentId: string) => new Promise<{ status: 'completed'; result: string }>((resolve) => {
      completions.set(agentId, resolve);
    }));
    const tool = createSubagentTool({ query: jest.fn(), spawn, waitForResult }, {
      maxConcurrentSubagents: 3,
    });

    const executions = ['one', 'two', 'three'].map((message, index) => tool.execute(`call-${index}`, {
      label: message,
      message,
      run_in_background: true,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(waitForResult).toHaveBeenCalledTimes(3);
    for (const [agentId, resolve] of completions) {
      resolve({ status: 'completed', result: `${agentId} done` });
    }
    await expect(Promise.all(executions)).resolves.toHaveLength(3);
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
