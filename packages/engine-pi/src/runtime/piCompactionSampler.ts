import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  getInstalledCustomProviderIds,
  streamPiAiModelsSimple,
} from '../models/piAiModels';
import { resolvePiModel, resolvePiProviderAuth } from '../models/piModelEnv';
import {
  COMPACTION_SYSTEM_PROMPT,
  convertCompactionMessages,
} from '../session/piContextCompaction';
import type { PiRuntimeHost } from './piRuntimeHost';

const COMPACTION_SAMPLE_TIMEOUT_MS = 120_000;
const COMPACTION_SAMPLE_MAX_TOKENS = 8_192;

function omitEmptyTools(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.tools) || record.tools.length > 0) {
    return undefined;
  }
  const { tools: _tools, ...withoutTools } = record;
  return withoutTools;
}

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
    const maxTokens = Math.min(
      COMPACTION_SAMPLE_MAX_TOKENS,
      model.maxTokens > 0 ? model.maxTokens : COMPACTION_SAMPLE_MAX_TOKENS,
    );
    const omitUnsupportedEmptyTools = model.api === 'openai-completions'
      && getInstalledCustomProviderIds().includes(model.provider);
    const stream = streamPiAiModelsSimple(model, {
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
      maxTokens,
      ...(omitUnsupportedEmptyTools ? { onPayload: omitEmptyTools } : {}),
      reasoning: 'low',
      signal: controller.signal,
      timeoutMs: COMPACTION_SAMPLE_TIMEOUT_MS,
    });
    const response = await stream.result();
    if (response.stopReason === 'pending') {
      throw new Error('Compaction sampling ended before the provider supplied a terminal stop reason.');
    }
    if (response.stopReason === 'aborted') {
      throw new Error('Cancelled');
    }
    if (response.stopReason === 'error') {
      throw new Error(response.errorMessage || 'Compaction sampling failed.');
    }
    if (response.stopReason === 'length') {
      throw new Error(
        `Compaction model output reached the ${maxTokens}-token limit before completing the checkpoint.`,
      );
    }
    if (response.stopReason === 'toolUse') {
      throw new Error('Compaction model returned an unexpected tool call.');
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
