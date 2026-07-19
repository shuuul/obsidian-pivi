import { QueryBackedTitleGenerationService } from '@pivi/pivi-agent-core/runtime/queryBackedTitleGenerationService';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';

function createRunner(response: string): AuxQueryRunner & { query: jest.Mock; reset: jest.Mock } {
  return {
    query: jest.fn(async () => response),
    reset: jest.fn(),
  };
}

describe('QueryBackedTitleGenerationService', () => {
  it('generates a parsed title and resets the per-request runner', async () => {
    const runner = createRunner('"Fix runtime imports."');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
      resolveModel: () => 'anthropic/test',
    });

    const result = await service.generateTitle('session-1', 'please fix runtime imports');

    expect(runner.query).toHaveBeenCalledWith(
      expect.objectContaining({
        abortController: expect.any(AbortController),
        model: 'anthropic/test',
        systemPrompt: expect.stringContaining('Generate a **concise, descriptive title**'),
      }),
      expect.stringContaining('please fix runtime imports'),
    );
    expect(result).toEqual({
      success: true,
      title: 'Fix runtime imports',
    });
    expect(runner.reset).toHaveBeenCalledTimes(1);
  });

  it('instructs the model to keep the generated title in the user request language', async () => {
    const runner = createRunner('整理会议记录');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const result = await service.generateTitle('session-1', '帮我整理会议记录');

    expect(runner.query).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Use the same natural language as the user\'s request'),
      }),
      expect.stringContaining('帮我整理会议记录'),
    );
    expect(result).toEqual({
      success: true,
      title: '整理会议记录',
    });
  });

  it('aborts and resets an in-flight generation when a newer one starts for the same session', async () => {
    let releaseFirst!: () => void;
    const firstRunner: AuxQueryRunner & { query: jest.Mock; reset: jest.Mock } = {
      query: jest.fn(() => new Promise<string>((resolve) => {
        releaseFirst = () => resolve('Old title');
      })),
      reset: jest.fn(),
    };
    const secondRunner = createRunner('New title');
    const runners = [firstRunner, secondRunner];
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runners.shift()!,
    });
    const first = service.generateTitle('session-1', 'old request');
    await Promise.resolve();
    const second = await service.generateTitle('session-1', 'new request');
    releaseFirst();
    await first;

    expect(firstRunner.query.mock.calls[0][0].abortController.signal.aborted).toBe(true);
    expect(firstRunner.reset).toHaveBeenCalled();
    expect(secondRunner.reset).toHaveBeenCalled();
    expect(second).toEqual({ success: true, title: 'New title' });
  });

  it('returns a failure result when the query fails', async () => {
    const runner = createRunner('');
    runner.query.mockRejectedValueOnce(new Error('provider unavailable'));
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    await expect(service.generateTitle('session-1', 'request')).resolves.toEqual({
      success: false,
      error: 'provider unavailable',
    });
    expect(runner.reset).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result when the response has no usable title', async () => {
    const runner = createRunner('""');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    await expect(service.generateTitle('session-1', 'request')).resolves.toEqual({
      success: false,
      error: 'Failed to parse title from response',
    });
  });
});
