import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { piAiModels } from './piAiModels';
import { resolvePiModel, resolvePiProviderAuth } from './piModelEnv';
import type { PiRuntimeHost } from './piRuntimeHost';
import {
  COMPACTION_SYSTEM_PROMPT,
  convertCompactionMessages,
} from './session/piContextCompaction';

const COMPACTION_SAMPLE_TIMEOUT_MS = 120_000;
const COMPACTION_SAMPLE_MAX_TOKENS = 8_192;

/**
 * Tool-less, low-reasoning sampler over Pi's model registry and canonical
 * conversation serializer. It does not own chat/session state.
 */
export async function sampleCompactionNote(
  host: PiRuntimeHost,
  messages: AgentMessage[],
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Cancelled');
  }
  const model = resolvePiModel(host);
  if (!model) {
    throw new Error('Could not resolve the active Pi model for compaction.');
  }
  const auth = await resolvePiProviderAuth(host, model);
  if (!auth) {
    throw new Error(`Credentials not found for provider: ${model.provider}`);
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, COMPACTION_SAMPLE_TIMEOUT_MS);
  try {
    const conversation = convertCompactionMessages(messages);
    const stream = piAiModels.streamSimple(model, {
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      messages: [
        ...conversation,
        {
          role: 'user',
          content: instruction,
          timestamp: Date.now(),
        },
      ],
    }, {
      apiKey: auth.auth.apiKey,
      cacheRetention: 'none',
      env: auth.env,
      headers: auth.auth.headers,
      maxRetries: 0,
      maxTokens: Math.min(
        COMPACTION_SAMPLE_MAX_TOKENS,
        model.maxTokens > 0 ? model.maxTokens : COMPACTION_SAMPLE_MAX_TOKENS,
      ),
      reasoning: 'low',
      signal: controller.signal,
      timeoutMs: COMPACTION_SAMPLE_TIMEOUT_MS,
    });
    const response = await stream.result();
    if (response.stopReason === 'aborted') {
      throw new Error('Cancelled');
    }
    if (response.stopReason === 'error') {
      throw new Error(response.errorMessage || 'Compaction sampling failed.');
    }
    const text = response.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (!text) {
      throw new Error('Compaction sampling returned no text.');
    }
    return text;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
