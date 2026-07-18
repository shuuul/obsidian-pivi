import type { Agent } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  isContextOverflow,
  isRetryableAssistantError,
} from '@earendil-works/pi-ai';

import type { StreamChunk } from '../../foundation';

export const PI_CHAT_MAX_RETRIES = 3;
export const PI_CHAT_RETRY_BASE_DELAY_MS = 2_000;

type PiChatRetryChunk = Extract<
  StreamChunk,
  { type: 'retry_end' | 'retry_start' }
>;

export interface PiChatRetryResult {
  finalMessage?: AssistantMessage;
  status: 'cancelled' | 'failed' | 'success';
}

export interface PiChatRetryOptions {
  agent: Agent;
  contextWindow: number;
  emit: (chunk: PiChatRetryChunk) => void;
  getLatestAssistantMessage: () => AssistantMessage | undefined;
  persistFailedAttempt: () => void;
  prompt: () => Promise<void>;
  signal: AbortSignal;
}

function removeFailedAssistantFromActiveContext(
  agent: Agent,
  message: AssistantMessage,
): void {
  const messages = agent.state.messages;
  const last = messages.at(-1);
  if (last === message || (
    last?.role === 'assistant'
    && last.stopReason === 'error'
  )) {
    agent.state.messages = messages.slice(0, -1);
  }
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function runAgentStep(
  step: () => Promise<void>,
  getLatestAssistantMessage: () => AssistantMessage | undefined,
  signal: AbortSignal,
): Promise<AssistantMessage | undefined> {
  const previousAssistant = getLatestAssistantMessage();
  try {
    await step();
  } catch (error) {
    const assistant = getLatestAssistantMessage();
    const emittedStepError = assistant !== previousAssistant
      && assistant?.stopReason === 'error';
    if (!signal.aborted && !emittedStepError) {
      throw error;
    }
  }
  return getLatestAssistantMessage();
}

export async function runPiChatPromptWithRetry(
  options: PiChatRetryOptions,
): Promise<PiChatRetryResult> {
  let retryAttempt = 0;
  let assistant = await runAgentStep(
    options.prompt,
    options.getLatestAssistantMessage,
    options.signal,
  );

  while (true) {
    if (options.signal.aborted) {
      if (retryAttempt > 0) {
        options.emit({
          type: 'retry_end',
          success: false,
          attempt: retryAttempt,
          finalError: 'Retry cancelled',
        });
      }
      return { status: 'cancelled', finalMessage: assistant };
    }

    if (assistant?.stopReason !== 'error') {
      if (retryAttempt > 0) {
        options.emit({
          type: 'retry_end',
          success: true,
          attempt: retryAttempt,
        });
      }
      return { status: 'success', finalMessage: assistant };
    }

    const retryable = !isContextOverflow(assistant, options.contextWindow)
      && isRetryableAssistantError(assistant);
    if (!retryable || retryAttempt >= PI_CHAT_MAX_RETRIES) {
      if (retryAttempt > 0) {
        options.emit({
          type: 'retry_end',
          success: false,
          attempt: retryAttempt,
          finalError: assistant.errorMessage,
        });
      }
      return { status: 'failed', finalMessage: assistant };
    }

    options.persistFailedAttempt();
    removeFailedAssistantFromActiveContext(options.agent, assistant);

    retryAttempt += 1;
    const delayMs = PI_CHAT_RETRY_BASE_DELAY_MS * 2 ** (retryAttempt - 1);
    options.emit({
      type: 'retry_start',
      attempt: retryAttempt,
      maxAttempts: PI_CHAT_MAX_RETRIES,
      delayMs,
      errorMessage: assistant.errorMessage ?? 'Unknown error',
    });

    if (!(await waitForRetryDelay(delayMs, options.signal))) {
      options.emit({
        type: 'retry_end',
        success: false,
        attempt: retryAttempt,
        finalError: 'Retry cancelled',
      });
      return { status: 'cancelled', finalMessage: assistant };
    }

    assistant = await runAgentStep(
      () => options.agent.continue(),
      options.getLatestAssistantMessage,
      options.signal,
    );
  }
}
