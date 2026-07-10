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
    const callback = jest.fn(async () => {});
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
      resolveModel: () => 'anthropic/test',
    });

    await service.generateTitle('session-1', 'please fix runtime imports', callback);

    expect(runner.query).toHaveBeenCalledWith(
      expect.objectContaining({
        abortController: expect.any(AbortController),
        model: 'anthropic/test',
        systemPrompt: expect.stringContaining('Generate a **concise, descriptive title**'),
      }),
      expect.stringContaining('please fix runtime imports'),
    );
    expect(callback).toHaveBeenCalledWith('session-1', {
      success: true,
      title: 'Fix runtime imports',
    });
    expect(runner.reset).toHaveBeenCalledTimes(1);
  });

  it('instructs the model to keep the generated title in the user request language', async () => {
    const runner = createRunner('整理会议记录');
    const callback = jest.fn(async () => {});
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    await service.generateTitle('session-1', '帮我整理会议记录', callback);

    expect(runner.query).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Use the same natural language as the user\'s request'),
      }),
      expect.stringContaining('帮我整理会议记录'),
    );
    expect(callback).toHaveBeenCalledWith('session-1', {
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
    const callback = jest.fn(async () => {});

    const first = service.generateTitle('session-1', 'old request', callback);
    await Promise.resolve();
    await service.generateTitle('session-1', 'new request', callback);
    releaseFirst();
    await first;

    expect(firstRunner.query.mock.calls[0][0].abortController.signal.aborted).toBe(true);
    expect(firstRunner.reset).toHaveBeenCalled();
    expect(secondRunner.reset).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('session-1', { success: true, title: 'New title' });
  });
});
