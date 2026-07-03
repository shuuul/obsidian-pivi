import type { PiSubagentQueryRunner } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';
import { createSubagentTool } from '@pivi/pivi-agent-core/engine/pi/createSubagentTool';

describe('createSubagentTool', () => {
  const BACKGROUND_ERROR =
    'Background sub-agents are not supported in Pivi Pi runtime. Omit run_in_background or set false.';

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
      prompt: '  do the work  ',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      {
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          'Task: Summarize notes',
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

  it('throws when prompt is empty or whitespace after trimming', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await expect(tool.execute('call-2', { prompt: '' })).rejects.toThrow('prompt is required');
    await expect(tool.execute('call-3', { prompt: '   \n\t  ' })).rejects.toThrow(
      'prompt is required',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws the unsupported background error when run_in_background is true', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await expect(
      tool.execute('call-4', { prompt: 'go', run_in_background: true }),
    ).rejects.toThrow(BACKGROUND_ERROR);
    expect(query).not.toHaveBeenCalled();
  });

  it('omits Task line from system prompt when description is omitted', async () => {
    const { runner, query } = createRunner();
    const tool = createSubagentTool(runner);

    await tool.execute('call-5', { prompt: 'only prompt' });

    expect(query).toHaveBeenCalledWith(
      {
        systemPrompt: [
          'You are a sub-agent completing one focused task.',
          'Return a concise final answer only.',
        ].join('\n'),
      },
      'only prompt',
    );
  });
});