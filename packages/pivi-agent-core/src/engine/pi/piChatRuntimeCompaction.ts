import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import {
  calculateContextEnvelope,
  calculateUsagePercentage,
  type CheckpointPresentation,
  type UsageInfo,
} from '../../foundation';
import type { StreamChunkQueue } from '../../runtime/streamChunkQueue';
import type { PreparedChatTurn } from '../../runtime/types';
import { sampleCompactionNote } from './piCompactionSampler';
import type { resolvePiModel } from './piModelEnv';
import { isPiModelContextWindowAuthoritative } from './piModelRegistry';
import type { PiRuntimeHost } from './piRuntimeHost';
import type { MissingAgentMessagesOptions } from './session/agentMessageHistory';
import {
  buildCheckpoint,
  buildCompactionPlan,
  buildCompactionSummary,
  buildFallbackPrompt,
  buildNote1Carrier,
  buildPass1Prompt,
  buildPass2Prompt,
  COMPACTION_PROMPT_VERSION,
  type CompactionDraft,
  compactionMessagesFromEntries,
  DEFAULT_COMPACTION_CONTEXT_WINDOW,
  estimateActiveContextCategories,
  estimateActiveContextTokens,
  estimateAgentMessageCategories,
  estimateAgentMessagesTokens,
  estimateTextTokens,
  findLatestCheckpoint,
  fingerprintCompactionEntries,
  getCompactionPrefireTokens,
  getCompactionThresholdTokens as computeCompactionThresholdTokens,
  parseCompactionDraft,
  type PiContextCompactionEntry,
  type PiContextCompactionPlan,
  PiContextTokenIndex,
  renderCheckpoint,
  renderCompactionDraft,
  shouldAutoCompact,
  toCheckpointPresentation,
} from './session/piContextCompaction';
import type { SessionTreeStore } from './session/sessionTreeStore';

interface PiCompactionPrefire {
  controller: AbortController;
  modelKey: string;
  note1: Promise<string | null>;
  prefixEntryCount: number;
  prefixFingerprint: string;
  promptVersion: string;
  sessionKey: string;
}

export interface PiChatCompactionState {
  autoCompactionInFlight: boolean;
  failedAutoFingerprint: string | null;
  foregroundController: AbortController | null;
  generation: number;
  prefire: PiCompactionPrefire | null;
}

export interface PiChatCompactionResult {
  checkpoint?: CheckpointPresentation;
  summary: string;
  tokensAfter: number;
  tokensBefore: number;
}

export interface PiChatCompactionDeps {
  plugin: PiRuntimeHost;
  sessionTree: SessionTreeStore | null;
  agent: Agent | null;
  compactionState: PiChatCompactionState;
  resolveModel: () => ReturnType<typeof resolvePiModel>;
  onLeafIdChanged: (leafId: string | null) => void;
  onAssistantMessageId: (entryId: string) => void;
}

const FALLBACK_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 3_000;
const contextTokenIndexes = new WeakMap<SessionTreeStore, PiContextTokenIndex>();
const compactionLocks = new WeakMap<
  SessionTreeStore,
  Promise<PiChatCompactionResult | null>
>();

function getContextTokenIndex(sessionTree: SessionTreeStore): PiContextTokenIndex {
  let index = contextTokenIndexes.get(sessionTree);
  if (!index) {
    index = new PiContextTokenIndex();
    contextTokenIndexes.set(sessionTree, index);
  }
  return index;
}

function activeEntries(sessionTree: SessionTreeStore): PiContextCompactionEntry[] {
  return sessionTree.getActiveLlmContextEntries();
}

function estimateSessionEntriesTokens(sessionTree: SessionTreeStore): number {
  return estimateActiveContextTokens(
    sessionTree.getLinearLlmContextEntries(),
    getContextTokenIndex(sessionTree),
  );
}

function estimateSystemTokens(agent: Agent | null): number {
  const systemPromptTokens = estimateTextTokens(agent?.state.systemPrompt ?? '');
  const toolSchemaTokens = estimateTextTokens(JSON.stringify(
    (agent?.state.tools ?? []).map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: (tool as { parameters?: unknown }).parameters,
    })),
  ));
  return systemPromptTokens + toolSchemaTokens;
}

function modelKey(deps: PiChatCompactionDeps): string {
  const model = deps.resolveModel();
  return model ? `${model.provider}/${model.id}` : '';
}

function sessionKey(deps: PiChatCompactionDeps): string {
  const tree = deps.sessionTree;
  return tree
    ? `${tree.getSessionId()}::${tree.getVaultRelativeSessionFile() ?? ''}`
    : '';
}

function currentFingerprint(deps: PiChatCompactionDeps): string {
  return deps.sessionTree
    ? fingerprintCompactionEntries(activeEntries(deps.sessionTree))
    : '';
}

export function invalidateCompactionState(state: PiChatCompactionState): void {
  state.generation += 1;
  state.prefire?.controller.abort();
  state.foregroundController?.abort();
  state.prefire = null;
  state.foregroundController = null;
  state.failedAutoFingerprint = null;
  state.autoCompactionInFlight = false;
}

export function attachContextEnvelope(
  deps: PiChatCompactionDeps,
  usage: UsageInfo,
  turn?: PreparedChatTurn,
  pendingMessages: AgentMessage[] = [],
): UsageInfo {
  const categories = deps.sessionTree
    ? estimateActiveContextCategories(deps.sessionTree.getLinearLlmContextEntries())
    : estimateAgentMessageCategories(
        pendingMessages.length > 0 ? pendingMessages : deps.agent?.state.messages ?? [],
      );
  if (deps.sessionTree && pendingMessages.length > 0) {
    const pending = estimateAgentMessageCategories(pendingMessages.filter((message) => (
      (message as unknown as { role?: unknown }).role !== 'user'
    )));
    categories.recentConversation += pending.recentConversation;
    categories.toolAndAgentResults += pending.toolAndAgentResults;
  }
  const selectedContext = deps.sessionTree && turn
    ? Math.max(0, estimateTextTokens(turn.prompt) - estimateTextTokens(turn.persistedContent))
    : 0;
  const contextEnvelope = calculateContextEnvelope({
    checkpoints: categories.checkpoints,
    contextWindow: usage.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
    contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
    outputTokenLimit: usage.outputTokenLimit,
    providerContextTokens: usage.contextTokensIsAuthoritative
      ? usage.contextTokens
      : undefined,
    recentConversation: categories.recentConversation,
    selectedContext,
    system: estimateSystemTokens(deps.agent),
    toolAndAgentResults: categories.toolAndAgentResults,
  });
  if (usage.contextTokensIsAuthoritative) {
    return { ...usage, contextEnvelope };
  }
  const contextTokens = contextEnvelope.total.tokens;
  return {
    ...usage,
    contextEnvelope,
    contextTokens,
    inputTokens: contextTokens,
    percentage: calculateUsagePercentage(contextTokens, usage.contextWindow),
  };
}

export function shouldAutoCompactSession(
  deps: PiChatCompactionDeps,
  providerUsage: UsageInfo,
): boolean {
  if (!deps.sessionTree) {
    return false;
  }
  return shouldAutoCompact({
    compactionInFlight: deps.compactionState.autoCompactionInFlight,
    failedFingerprint: deps.compactionState.failedAutoFingerprint,
    providerUsage,
    sessionFingerprint: currentFingerprint(deps),
    sessionLeafId: deps.sessionTree.getLeafId(),
    storedConversationTokens: estimateStoredConversationTokens(deps),
  });
}

export function getCompactionThresholdTokens(
  deps: PiChatCompactionDeps,
  contextWindow = deps.resolveModel()?.contextWindow ?? DEFAULT_COMPACTION_CONTEXT_WINDOW,
): number {
  const model = deps.resolveModel();
  return computeCompactionThresholdTokens(
    contextWindow,
    isPiModelContextWindowAuthoritative(model),
    model?.maxTokens,
  );
}

export function estimateStoredConversationTokens(deps: PiChatCompactionDeps): number {
  return deps.sessionTree ? estimateSessionEntriesTokens(deps.sessionTree) : 0;
}

export function estimateProjectedTurnTokens(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
): number {
  const sessionTokens = deps.sessionTree
    ? estimateSessionEntriesTokens(deps.sessionTree)
    : estimateAgentMessagesTokens(deps.agent?.state.messages ?? []);
  return sessionTokens + estimateSystemTokens(deps.agent) + estimateTextTokens(turn.prompt);
}

function getPlan(deps: PiChatCompactionDeps): PiContextCompactionPlan | null {
  return deps.sessionTree ? buildCompactionPlan(activeEntries(deps.sessionTree)) : null;
}

export function canCompactCurrentSession(deps: PiChatCompactionDeps): boolean {
  return getPlan(deps) !== null;
}

export async function prepareContextForTurn(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
  queue: StreamChunkQueue,
): Promise<boolean | null> {
  if (!deps.sessionTree || !isPiModelContextWindowAuthoritative(deps.resolveModel())) {
    return false;
  }
  const thresholdTokens = getCompactionThresholdTokens(deps);
  if (estimateProjectedTurnTokens(deps, turn) < thresholdTokens) {
    return false;
  }

  let compacted = false;
  if (canCompactCurrentSession(deps)) {
    queue.push({ type: 'context_compacting' });
    const compaction = await compactCurrentSession(deps, 'threshold');
    compacted = compaction !== null;
    if (compaction) {
      queue.push({ type: 'context_compacted', ...compaction });
    }
  }
  if (estimateProjectedTurnTokens(deps, turn) < thresholdTokens) {
    return compacted;
  }
  queue.push({
    type: 'error',
    content: 'This turn is too large to send safely within the fixed context budget. Reduce attached context or use obsidian_read with narrower line ranges.',
  });
  return null;
}

export function prepareCompactionPrefire(
  deps: PiChatCompactionDeps,
  usage: UsageInfo,
): void {
  const tree = deps.sessionTree;
  const model = deps.resolveModel();
  if (!tree || !model || !isPiModelContextWindowAuthoritative(model)) {
    return;
  }
  const envelope = usage.contextEnvelope;
  const hardTrigger = envelope?.compactionTriggerTokens
    ?? getCompactionThresholdTokens(deps, usage.contextWindow);
  const pressure = envelope?.pressureInputTokens
    ?? Math.max(usage.contextTokens, estimateStoredConversationTokens(deps));
  const prefireTrigger = getCompactionPrefireTokens(
    hardTrigger,
    usage.contextWindow || model.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
  );
  if (pressure < prefireTrigger || pressure >= hardTrigger) {
    return;
  }
  const plan = getPlan(deps);
  if (!plan) {
    return;
  }
  const existing = deps.compactionState.prefire;
  if (
    existing
    && matchingPrefire(deps, plan.activeEntries)
  ) {
    return;
  }
  existing?.controller.abort();
  const controller = new AbortController();
  const generation = deps.compactionState.generation;
  const prefire: PiCompactionPrefire = {
    controller,
    modelKey: modelKey(deps),
    note1: Promise.resolve(null),
    prefixEntryCount: plan.prefixEntries.length,
    prefixFingerprint: plan.prefixFingerprint,
    promptVersion: COMPACTION_PROMPT_VERSION,
    sessionKey: sessionKey(deps),
  };
  prefire.note1 = sampleValidatedNote(
    deps,
    plan.prefixMessages,
    buildPass1Prompt(),
    controller.signal,
  ).catch(() => null).then((note) => (
    generation === deps.compactionState.generation ? note : null
  ));
  deps.compactionState.prefire = prefire;
}

async function sampleValidatedNote(
  deps: PiChatCompactionDeps,
  messages: AgentMessage[],
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  return renderCompactionDraft(
    await sampleValidatedDraft(deps, messages, prompt, signal),
  );
}

async function sampleValidatedDraft(
  deps: PiChatCompactionDeps,
  messages: AgentMessage[],
  prompt: string,
  signal: AbortSignal,
): Promise<CompactionDraft> {
  const sampled = await sampleCompactionNote(deps.plugin, messages, prompt, signal);
  const draft = parseCompactionDraft(sampled);
  if (!draft) {
    throw new Error('Compaction model returned an invalid or undersized checkpoint.');
  }
  return draft;
}

function matchingPrefire(
  deps: PiChatCompactionDeps,
  entries: PiContextCompactionEntry[],
): PiCompactionPrefire | null {
  const prefire = deps.compactionState.prefire;
  if (
    !prefire
    || prefire.sessionKey !== sessionKey(deps)
    || prefire.modelKey !== modelKey(deps)
    || prefire.promptVersion !== COMPACTION_PROMPT_VERSION
    || prefire.prefixEntryCount >= entries.length
  ) {
    return null;
  }
  const prefix = entries.slice(0, prefire.prefixEntryCount);
  return fingerprintCompactionEntries(prefix) === prefire.prefixFingerprint
    ? prefire
    : null;
}

async function waitForRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new Error('Cancelled');
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(finish, FALLBACK_RETRY_DELAY_MS);
    const abort = (): void => {
      window.clearTimeout(timer);
      reject(new Error('Cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function sampleFallback(
  deps: PiChatCompactionDeps,
  plan: PiContextCompactionPlan,
  instructions: string | undefined,
  signal: AbortSignal,
): Promise<CompactionDraft> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt++) {
    if (signal.aborted) {
      throw new Error('Cancelled');
    }
    try {
      return await sampleValidatedDraft(
        deps,
        compactionMessagesFromEntries(plan.activeEntries),
        buildFallbackPrompt(instructions),
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      lastError = error;
      if (attempt + 1 < FALLBACK_ATTEMPTS) {
        await waitForRetry(signal);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Compaction fallback failed.');
}

async function sampleFinalNote(
  deps: PiChatCompactionDeps,
  plan: PiContextCompactionPlan,
  instructions: string | undefined,
  signal: AbortSignal,
): Promise<CompactionDraft> {
  try {
    const prefire = matchingPrefire(deps, plan.activeEntries);
    let note1: string | null = prefire ? await prefire.note1 : null;
    let tailMessages = plan.tailMessages;
    if (prefire && note1) {
      tailMessages = compactionMessagesFromEntries(
        plan.activeEntries.slice(prefire.prefixEntryCount),
      );
    } else {
      note1 = await sampleValidatedNote(
        deps,
        plan.prefixMessages,
        buildPass1Prompt(),
        signal,
      );
    }
    if (!note1) {
      throw new Error('No reusable NOTE₁ is available.');
    }
    return await sampleValidatedDraft(
      deps,
      [buildNote1Carrier(note1), ...tailMessages],
      buildPass2Prompt(instructions),
      signal,
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return sampleFallback(deps, plan, instructions, signal);
  }
}

async function compactUnlocked(
  deps: PiChatCompactionDeps,
  reason: 'manual' | 'threshold',
  instructions?: string,
): Promise<PiChatCompactionResult | null> {
  const tree = deps.sessionTree;
  if (!tree) {
    return null;
  }
  const plan = getPlan(deps);
  if (!plan) {
    return null;
  }
  const fingerprint = fingerprintCompactionEntries(plan.activeEntries);
  const generation = deps.compactionState.generation;
  const initialModelKey = modelKey(deps);
  const initialSessionKey = sessionKey(deps);
  if (
    reason === 'threshold'
    && deps.compactionState.failedAutoFingerprint === fingerprint
  ) {
    return null;
  }

  deps.compactionState.autoCompactionInFlight = true;
  const controller = new AbortController();
  deps.compactionState.foregroundController = controller;
  try {
    const draft = await sampleFinalNote(
      deps,
      plan,
      instructions,
      controller.signal,
    );
    if (
      controller.signal.aborted
      || deps.compactionState.generation !== generation
      || deps.sessionTree !== tree
      || sessionKey(deps) !== initialSessionKey
      || modelKey(deps) !== initialModelKey
      || currentFingerprint(deps) !== fingerprint
    ) {
      throw new Error('Session or model changed while context compaction was running.');
    }
    const previousCheckpoint = findLatestCheckpoint(plan.activeEntries);
    const appended = tree.appendFullReplacementCompaction(
      plan.tokensBefore,
      (boundaryId) => {
        const checkpoint = buildCheckpoint(
          draft,
          plan,
          previousCheckpoint,
          boundaryId,
        );
        if (!checkpoint) {
          throw new Error('Final NOTE₂ could not be persisted as a checkpoint.');
        }
        return checkpoint;
      },
      (boundedCheckpoint) => buildCompactionSummary(renderCheckpoint(boundedCheckpoint)),
    );
    deps.onLeafIdChanged(tree.getLeafId());
    deps.onAssistantMessageId(appended.compactionId);
    deps.compactionState.failedAutoFingerprint = null;
    deps.compactionState.prefire = null;
    if (deps.agent) {
      deps.agent.state.messages = tree.loadAgentMessages();
    }
    return {
      checkpoint: toCheckpointPresentation(appended.checkpoint),
      summary: appended.summary,
      tokensAfter: estimateSessionEntriesTokens(tree),
      tokensBefore: plan.tokensBefore,
    };
  } catch (error) {
    if (
      reason === 'threshold'
      && !controller.signal.aborted
      && deps.compactionState.generation === generation
      && deps.sessionTree === tree
      && sessionKey(deps) === initialSessionKey
      && modelKey(deps) === initialModelKey
      && currentFingerprint(deps) === fingerprint
    ) {
      deps.compactionState.failedAutoFingerprint = fingerprint;
    }
    throw error;
  } finally {
    if (deps.compactionState.foregroundController === controller) {
      deps.compactionState.foregroundController = null;
    }
    deps.compactionState.autoCompactionInFlight = false;
  }
}

export async function compactCurrentSession(
  deps: PiChatCompactionDeps,
  reason: 'manual' | 'threshold',
  instructions?: string,
): Promise<PiChatCompactionResult | null> {
  const tree = deps.sessionTree;
  if (!tree) {
    return null;
  }
  const existing = compactionLocks.get(tree);
  if (existing) {
    const result = await existing;
    if (deps.agent) {
      deps.agent.state.messages = tree.loadAgentMessages();
    }
    return result;
  }
  const task = compactUnlocked(deps, reason, instructions);
  compactionLocks.set(tree, task);
  try {
    return await task;
  } finally {
    if (compactionLocks.get(tree) === task) {
      compactionLocks.delete(tree);
    }
  }
}

export function buildTurnSyncOptions(
  turn?: PreparedChatTurn,
): MissingAgentMessagesOptions | undefined {
  if (!turn || turn.persistedContent === turn.prompt) {
    return undefined;
  }
  return {
    userMessageEquivalences: [{
      existingText: turn.persistedContent,
      incomingText: turn.prompt,
    }],
  };
}

export function syncSessionMessagesAfterTurn(
  sessionTree: SessionTreeStore | null,
  messages: AgentMessage[],
  turn: PreparedChatTurn | undefined,
  onLeafIdChanged: (leafId: string | null) => void,
  onAssistantMessageId: (entryId: string | undefined) => void,
): void {
  if (!sessionTree || messages.length === 0) {
    return;
  }
  sessionTree.syncAgentMessages(messages, buildTurnSyncOptions(turn));
  onLeafIdChanged(sessionTree.getLeafId());
  onAssistantMessageId(
    sessionTree.findLastVisibleMessageEntryId('assistant') ?? undefined,
  );
}
