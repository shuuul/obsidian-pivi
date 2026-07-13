import type { Agent } from '@earendil-works/pi-agent-core';
import { PiBackgroundSubagentJobs } from '@pivi/pivi-agent-core/engine/pi/piBackgroundSubagentJobs';
import { SubagentConcurrencyLimiter } from '@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter';

interface Deferred {
  resolve(): void;
  promise: Promise<void>;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

function createAgent(prompt: (message: string) => Promise<void>): Agent {
  return {
    abort: jest.fn(),
    prompt,
    reset: jest.fn(),
    state: { messages: [{ role: 'assistant', content: 'done' }] },
    subscribe: jest.fn(() => () => undefined),
  } as unknown as Agent;
}

describe('PiBackgroundSubagentJobs concurrency', () => {
  it('atomically limits 10 parallel spawns and admits overflow in FIFO order', async () => {
    const limiter = new SubagentConcurrencyLimiter(() => 3);
    const deferredByPrompt = new Map<string, Deferred>();
    const starts: string[] = [];
    let createCount = 0;
    const jobs = new PiBackgroundSubagentJobs({
      concurrencyLimiter: limiter,
      createAgent: async () => {
        createCount += 1;
        return createAgent(async (prompt) => {
          starts.push(prompt);
          const deferred = createDeferred();
          deferredByPrompt.set(prompt, deferred);
          await deferred.promise;
        });
      },
    });

    const launches = Array.from({ length: 10 }, (_, index) => jobs.spawn({
      systemPrompt: 'helper',
      toolCallId: `call-${index + 1}`,
      purpose: `task-${index + 1}`,
    }, `task-${index + 1}`));
    await Promise.all(launches.slice(0, 3));

    expect(createCount).toBe(3);
    expect(starts).toEqual(['task-1', 'task-2', 'task-3']);
    expect(limiter.getSnapshot()).toEqual({
      maxConcurrentSubagents: 3,
      queuedSubagents: 7,
      runningSubagents: 3,
    });

    for (let index = 1; index <= 7; index++) {
      deferredByPrompt.get(`task-${index}`)!.resolve();
      await launches[index + 2];
      await Promise.resolve();
      expect(starts[index + 2]).toBe(`task-${index + 3}`);
    }
    deferredByPrompt.get('task-8')!.resolve();
    deferredByPrompt.get('task-9')!.resolve();
    deferredByPrompt.get('task-10')!.resolve();
    const results = await Promise.all(launches);

    expect(results.slice(0, 3).every((result) => !result.queued)).toBe(true);
    expect(results.slice(3).map((result) => result.queuePosition)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shares one concurrency limit across independent tab job stores', async () => {
    const limiter = new SubagentConcurrencyLimiter(() => 1);
    const firstDone = createDeferred();
    const starts: string[] = [];
    const createJobs = () => new PiBackgroundSubagentJobs({
      concurrencyLimiter: limiter,
      createAgent: async () => createAgent(async (prompt) => {
        starts.push(prompt);
        if (prompt === 'tab-a') {
          await firstDone.promise;
        }
      }),
    });
    const tabA = createJobs();
    const tabB = createJobs();

    const first = tabA.spawn({ systemPrompt: 'helper', toolCallId: 'a', purpose: 'a' }, 'tab-a');
    const second = tabB.spawn({ systemPrompt: 'helper', toolCallId: 'b', purpose: 'b' }, 'tab-b');
    await first;
    await Promise.resolve();

    expect(starts).toEqual(['tab-a']);
    expect(limiter.getSnapshot().queuedSubagents).toBe(1);

    firstDone.resolve();
    const secondLaunch = await second;

    expect(starts).toEqual(['tab-a', 'tab-b']);
    expect(secondLaunch.queued).toBe(true);
    expect(secondLaunch.runningAtRequest).toBe(1);
  });
});
