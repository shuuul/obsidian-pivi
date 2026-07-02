import { QueryBackedTitleGenerationService } from '@pivi/pi-runtime/QueryBackedTitleGenerationService';
import type { AuxQueryRunner } from '@pivi/pi-runtime/AuxQueryRunner';

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
