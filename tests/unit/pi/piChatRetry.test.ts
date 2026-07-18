import type { Agent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';

import {
  PI_CHAT_MAX_RETRIES,
  runPiChatPromptWithRetry,
} from '../../../packages/pivi-agent-core/src/engine/pi/piChatRetry';

function assistant(
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.3-codex-spark',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function createHarness(responses: AssistantMessage[]) {
  let latest: AssistantMessage | undefined;
  const state = { messages: [] as AssistantMessage[] };
  const applyNext = (): void => {
    latest = responses.shift();
    if (latest) state.messages.push(latest);
  };
  const continuePrompt = jest.fn(async () => applyNext());
  const agent = {
    state,
    continue: continuePrompt,
  } as unknown as Agent;
  const chunks: StreamChunk[] = [];
  const persisted: AssistantMessage[][] = [];
  const controller = new AbortController();
  const run = () => runPiChatPromptWithRetry({
    agent,
    contextWindow: 200_000,
    emit: (chunk) => chunks.push(chunk),
    getLatestAssistantMessage: () => latest,
    persistFailedAttempt: () => persisted.push([...state.messages]),
    prompt: async () => applyNext(),
    signal: controller.signal,
  });
  return {
    agent,
    chunks,
    continuePrompt,
    controller,
    persisted,
    run,
    state,
  };
}

describe('runPiChatPromptWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries transient assistant errors with exponential backoff and succeeds', async () => {
    const harness = createHarness([
      assistant('error', 'socket hang up'),
      assistant('error', '500 server error'),
      assistant('stop'),
    ]);

    const resultPromise = harness.run();
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);

    await expect(resultPromise).resolves.toMatchObject({ status: 'success' });
    expect(harness.continuePrompt).toHaveBeenCalledTimes(2);
    expect(harness.persisted).toHaveLength(2);
    expect(harness.chunks).toEqual([
      {
        type: 'retry_start',
        attempt: 1,
        maxAttempts: PI_CHAT_MAX_RETRIES,
        delayMs: 2_000,
        errorMessage: 'socket hang up',
      },
      {
        type: 'retry_start',
        attempt: 2,
        maxAttempts: PI_CHAT_MAX_RETRIES,
        delayMs: 4_000,
        errorMessage: '500 server error',
      },
      {
        type: 'retry_end',
        success: true,
        attempt: 2,
      },
    ]);
    expect(harness.state.messages).toEqual([expect.objectContaining({ stopReason: 'stop' })]);
  });

  it('stops after three retries and keeps the final failure active', async () => {
    const harness = createHarness([
      assistant('error', 'socket hang up'),
      assistant('error', '500 server error'),
      assistant('error', 'timed out'),
      assistant('error', 'socket hang up'),
    ]);

    const resultPromise = harness.run();
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);
    await jest.advanceTimersByTimeAsync(8_000);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'failed',
      finalMessage: expect.objectContaining({ errorMessage: 'socket hang up' }),
    });
    expect(harness.continuePrompt).toHaveBeenCalledTimes(3);
    expect(harness.persisted).toHaveLength(3);
    expect(harness.chunks.at(-1)).toEqual({
      type: 'retry_end',
      success: false,
      attempt: 3,
      finalError: 'socket hang up',
    });
    expect(harness.state.messages).toEqual([
      expect.objectContaining({ errorMessage: 'socket hang up' }),
    ]);
  });

  it('does not retry context overflow errors', async () => {
    const harness = createHarness([
      assistant('error', 'context overflow'),
    ]);

    await expect(harness.run()).resolves.toMatchObject({ status: 'failed' });
    expect(harness.continuePrompt).not.toHaveBeenCalled();
    expect(harness.persisted).toHaveLength(0);
    expect(harness.chunks).toEqual([]);
  });

  it('does not mistake a rejected continuation for the previous assistant failure', async () => {
    const harness = createHarness([
      assistant('error', 'socket hang up'),
    ]);
    harness.continuePrompt.mockRejectedValueOnce(new Error('continuation setup failed'));

    const resultPromise = harness.run();
    let rejection: unknown;
    const observedResult = resultPromise.catch((error: unknown) => {
      rejection = error;
    });
    await jest.advanceTimersByTimeAsync(2_000);

    await observedResult;
    expect(rejection).toEqual(new Error('continuation setup failed'));
    expect(harness.continuePrompt).toHaveBeenCalledTimes(1);
    expect(harness.persisted).toHaveLength(1);
  });

  it('cancels an in-flight backoff without continuing the agent', async () => {
    const harness = createHarness([
      assistant('error', 'socket hang up'),
      assistant('stop'),
    ]);

    const resultPromise = harness.run();
    await jest.advanceTimersByTimeAsync(0);
    expect(harness.chunks).toEqual([
      expect.objectContaining({ type: 'retry_start', attempt: 1 }),
    ]);
    harness.controller.abort();

    await expect(resultPromise).resolves.toMatchObject({ status: 'cancelled' });
    expect(harness.continuePrompt).not.toHaveBeenCalled();
    expect(harness.chunks).toEqual([
      expect.objectContaining({ type: 'retry_start', attempt: 1 }),
      {
        type: 'retry_end',
        success: false,
        attempt: 1,
        finalError: 'Retry cancelled',
      },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
