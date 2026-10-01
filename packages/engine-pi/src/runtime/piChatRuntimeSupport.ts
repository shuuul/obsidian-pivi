/** Stateless steps of the chat runtime: provider auth and model follow-up, prompt replacement, and manual compaction. */

import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import {
  createInitialSystemMessage,
  getInitialSystemMessage,
  type SystemMessage,
} from '@earendil-works/pi-ai';
import { getProviderAuthFailureHint } from '@pivi/agent/auth/providerAuthFailureHint';
import { getProviderEnvVarNames } from '@pivi/agent/auth/providerEnvVars';
import type { StreamChunk } from '@pivi/agent/runtime';

import { refreshCustomPiProviderModels } from '../models/piAiModels';
import { resolvePiModelByKey } from '../models/piModelEnv';
import type { PiResolvedModel } from '../models/piModelRegistry';
import type { PiChatErrorContext } from './piAgentEventAdapter';
import {
  attachContextEnvelope,
  buildUsageAfterCompaction,
  compactCurrentSession,
  type PiChatCompactionDeps,
} from './piChatRuntimeCompaction';
import {
  buildEstimatedUsageInfo,
  latestUsageFromMessages,
} from './piChatRuntimeUsage';

/** Local servers report real context metadata only after they load a model. */
const POST_LOAD_MODEL_METADATA_PROVIDER_IDS = new Set([
  'ollama',
  'lmstudio',
  'llama-cpp',
]);

export function describeAgentInitFailure(model: PiResolvedModel | null): string {
  const providerHint = model
    ? getProviderAuthFailureHint(model.provider)
    : 'Check your model selection in settings.';
  return `Failed to initialize Pi Agent. ${providerHint}`;
}

export function describeMissingProviderAuth(provider: string): string {
  if (provider === 'openai-codex') {
    return 'OpenAI Codex OAuth credentials are missing or unavailable. Reconnect OpenAI Codex in provider settings.';
  }
  const expectedVar = getProviderEnvVarNames(provider).apiKeyVar;
  return `API key not found for provider: ${provider}. Set the environment variable ${expectedVar} in plugin settings.`;
}

/**
 * Pi 0.86 derives AgentState.systemPrompt by replaying the transcript's
 * system messages, so a prompt change replaces the leading system message
 * in place (keeping its tool declarations) instead of assigning the
 * now-read-only state field.
 */
export function replaceLeadingSystemPrompt(agent: Agent, nextPrompt: string): void {
  const messages = [...agent.state.messages];
  const initial = getInitialSystemMessage(messages);
  if (initial) {
    const replacement: SystemMessage = { ...initial, content: nextPrompt };
    agent.state.messages = [replacement, ...messages.slice(1)];
  } else {
    const seeded = createInitialSystemMessage(nextPrompt, undefined);
    agent.state.messages = seeded ? [seeded, ...messages] : messages;
  }
}

/** Refresh a local provider's model metadata once per model after its first prompt. */
export async function refreshLocalModelMetadata(
  agent: Agent,
  refreshedModelKeys: Set<string>,
  resolveModel: () => PiResolvedModel | null,
  warn: (message: string) => void,
): Promise<boolean> {
  const model = agent.state.model;
  if (!model || !POST_LOAD_MODEL_METADATA_PROVIDER_IDS.has(model.provider)) {
    return false;
  }
  const modelKey = `${model.provider}/${model.id}`;
  if (refreshedModelKeys.has(modelKey)) {
    return false;
  }
  try {
    if (await refreshCustomPiProviderModels(model.provider)) {
      refreshedModelKeys.add(modelKey);
      const refreshedModel = resolveModel();
      if (
        refreshedModel?.provider === model.provider
        && refreshedModel.id === model.id
      ) {
        agent.state.model = refreshedModel;
        return true;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Failed to refresh ${model.provider} model metadata after first prompt: ${message}`);
  }
  return false;
}

/**
 * The failed assistant message records the serving provider/model; settings
 * may already point at a different model, so diagnostics resolve from the
 * message first and fall back to the current selection.
 */
export function resolveChatErrorContext(
  message: Record<string, unknown>,
  context: {
    customContextLimits: Parameters<typeof resolvePiModelByKey>[1];
    resolveModel: () => PiResolvedModel | null;
    messages: AgentMessage[];
    compactionDeps: PiChatCompactionDeps;
  },
): PiChatErrorContext | null {
  const provider = typeof message.provider === 'string' ? message.provider : '';
  const modelId = typeof message.model === 'string' ? message.model : '';
  const servingModel = provider && modelId
    ? resolvePiModelByKey(`${provider}/${modelId}`, context.customContextLimits)
    : null;
  const model = servingModel ?? context.resolveModel();
  if (!model) {
    return null;
  }
  const { messages } = context;
  const usage = latestUsageFromMessages(messages, model)
    ?? buildEstimatedUsageInfo(messages, model);
  const projected = usage
    ? attachContextEnvelope(context.compactionDeps, usage, undefined, messages)
    : null;
  const contextTokens = projected?.contextTokens ?? usage?.contextTokens ?? 0;
  return {
    model: `${model.provider}/${model.id}`,
    contextWindow: model.contextWindow ?? 0,
    ...(contextTokens > 0 ? { contextTokens } : {}),
  };
}

/**
 * Authorize the model a turn is about to use, following a selection that
 * changed while authorization was pending. Returns null when the turn went
 * stale or no model resolves.
 */
export async function authorizeModelSelection(
  model: PiResolvedModel,
  hooks: {
    resolveAuth: (model: PiResolvedModel) => Promise<unknown>;
    resolveModel: () => PiResolvedModel | null;
    isStale: () => boolean;
    sync: (model: PiResolvedModel) => void;
  },
): Promise<PiResolvedModel | null> {
  let selectedModel = model;
  while (true) {
    const auth = await hooks.resolveAuth(selectedModel);
    if (hooks.isStale()) return null;
    if (!auth) {
      throw new Error(`Provider authentication is unavailable for ${selectedModel.provider}.`);
    }

    const latestModel = hooks.resolveModel();
    if (!latestModel) return null;
    if (
      latestModel.provider !== selectedModel.provider
      || latestModel.id !== selectedModel.id
    ) {
      selectedModel = latestModel;
      continue;
    }
    hooks.sync(selectedModel);
    return selectedModel;
  }
}

/** The `/compact` turn: compact now and report the result instead of prompting the model. */
export async function* streamManualCompaction(
  compactionDeps: () => PiChatCompactionDeps,
  instructions: string | undefined,
): AsyncGenerator<StreamChunk> {
  try {
    const compacted = await compactCurrentSession(compactionDeps(), 'manual', instructions);
    if (compacted) {
      yield { type: 'context_compacted', ...compacted };
      const usage = buildUsageAfterCompaction(
        compactionDeps(),
        undefined,
        compacted.tokensAfter,
      );
      if (usage) {
        yield { type: 'usage', usage };
      }
    } else {
      yield { type: 'notice', level: 'info', content: 'There is not enough session history to compact yet.' };
    }
  } catch (error) {
    yield { type: 'error', content: error instanceof Error ? error.message : String(error) };
  }
  yield { type: 'done' };
}
