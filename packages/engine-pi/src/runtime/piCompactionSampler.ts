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

/**
 * Fallback ceiling for slow hosts that supply no provider deadlines. Product
 * settings always provide `providerRequestDeadlines`, so the real budget
 * follows the configurable provider Total deadline (issues #89, #98): slow
 * local models can need far more than 120 seconds for a compaction sample, and
 * the old hard cap cut off `/compact` even with the deadline raised or disabled.
 */
const DEFAULT_COMPACTION_SAMPLE_TIMEOUT_MS = 120_000;
const COMPACTION_SAMPLE_MAX_TOKENS = 8_192;

/** Resolved sampling budget; `null` means the deadline is disabled (`0`). */
function resolveCompactionSampleTimeoutMs(host: PiRuntimeHost): number | null {
  const configured = host.settings.providerRequestDeadlines?.totalMs;
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured < 0) {
    return DEFAULT_COMPACTION_SAMPLE_TIMEOUT_MS;
  }
  const truncated = Math.trunc(configured);
  return truncated > 0 ? truncated : null;
}

export class PiCompactionTimeoutError extends Error {
  readonly code = 'PI_COMPACTION_TIMEOUT';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Compaction sampling timed out after ${Math.round(timeoutMs / 1_000)} seconds.`);
    this.name = 'PiCompactionTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

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

  const timeoutMs = resolveCompactionSampleTimeoutMs(host);
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = timeoutMs === null
    ? undefined
    : window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
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
      // A disabled budget omits the key so provider SDKs keep their own
      // defaults instead of receiving a literal 0 timeout.
      ...(timeoutMs !== null ? { timeoutMs } : {}),
    });
    const response = await stream.result();
    if (response.stopReason === 'pending') {
      throw new Error('Compaction sampling ended before the provider supplied a terminal stop reason.');
    }
    if (response.stopReason === 'aborted') {
      if (timedOut && timeoutMs !== null && !signal?.aborted) {
        throw new PiCompactionTimeoutError(timeoutMs);
      }
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
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
    signal?.removeEventListener('abort', abort);
  }
}
