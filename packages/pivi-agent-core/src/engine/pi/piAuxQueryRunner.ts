import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import type { StreamChunk, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';

import type { AuxQueryConfig, AuxQueryRunner } from '../../runtime/auxQueryRunner';
import { PiAgentEventAdapter } from './piAgentEventAdapter';
import { piAiModels } from './piAiModels';
import { resolvePiModel, resolvePiProviderAuth } from './piModelEnv';
import type { PiRuntimeHost } from './piRuntimeHost';

type PiAgentOptions = NonNullable<ConstructorParameters<typeof Agent>[0]>;
type PiAuxQueryModel = Extract<NonNullable<PiAgentOptions['initialState']>['model'], { provider: string }>;
type PiAuxQueryStreamFn = PiAgentOptions['streamFn'];

export interface PiAuxQueryRunnerDependencies<TModel extends PiAuxQueryModel = PiAuxQueryModel> {
  resolveModel(modelKey?: string): TModel | null;
  resolveAuth(model: TModel): Promise<unknown | undefined>;
  streamSimple: PiAuxQueryStreamFn;
  onSubagentChunk?: (chunk: StreamChunk) => void;
  getMaxConcurrentSubagents?: () => number;
  getTools?: () => AgentTool[];
  getSettings?: () => Record<string, unknown>;
}

interface BackgroundSubagentJob {
  agentId: string;
  purposeKey: string;
  toolCallId: string;
  agent: Agent;
  toolCalls: ToolCallInfo[];
  finalResult: string | null;
  error: string | null;
  status: 'running' | 'completed' | 'error';
  completion: Promise<{ status: 'completed' | 'error'; result: string }>;
  resolveCompletion: (result: { status: 'completed' | 'error'; result: string }) => void;
  lastUsedAt: number;
}

let nextSubagentId = 1;

const DEFAULT_SUBAGENT_CONTEXT_WINDOW = 200_000;

function createBackgroundCompletion(): {
  completion: Promise<{ status: 'completed' | 'error'; result: string }>;
  resolveCompletion: (result: { status: 'completed' | 'error'; result: string }) => void;
} {
  let resolveCompletion!: (result: { status: 'completed' | 'error'; result: string }) => void;
  const completion = new Promise<{ status: 'completed' | 'error'; result: string }>((resolve) => {
    resolveCompletion = resolve;
  });
  return { completion, resolveCompletion };
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') return record.text;
    if (record.type === 'thinking' && typeof record.thinking === 'string') return `[thinking]\n${record.thinking}`;
    if (record.type === 'toolCall') return `[tool call: ${String(record.name ?? 'tool')}] ${JSON.stringify(record.arguments ?? {})}`;
    return '';
  }).filter(Boolean).join('\n');
}

function textFromAgentMessage(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  return textFromContent(record.content);
}

function estimateAgentMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTextTokens(textFromAgentMessage(message)), 0);
}

export class PiAuxQueryRunner<TModel extends PiAuxQueryModel = PiAuxQueryModel> implements AuxQueryRunner {
  private agent: Agent | null = null;
  private configKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter();
  private readonly backgroundJobs = new Map<string, BackgroundSubagentJob>();

  constructor(private readonly dependencies: PiAuxQueryRunnerDependencies<TModel>) {}

  reset(): void {
    this.agent?.abort();
    this.agent?.reset();
    this.agent = null;
    this.configKey = null;
  }

  abortAllSubagents(): void {
    for (const job of this.backgroundJobs.values()) {
      if (job.status === 'running') {
        job.status = 'error';
        job.error = 'Cancelled';
        job.finalResult = job.error;
        job.resolveCompletion({ status: 'error', result: job.error });
        job.agent.abort();
      }
      job.agent.reset();
    }
    this.backgroundJobs.clear();
  }

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const agent = await this.ensureAgent(config);
    let accumulatedText = '';
    let errorMessage: string | null = null;

    const unsubscribe = agent.subscribe((event) => {
      for (const chunk of this.eventAdapter.adapt(event)) {
        if (chunk.type === 'text') {
          accumulatedText += chunk.content;
          config.onTextChunk?.(accumulatedText);
        } else if (chunk.type === 'error') {
          errorMessage = chunk.content;
        }
      }
    });

    const abortHandler = (): void => {
      agent.abort();
    };
    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      await agent.prompt(prompt);

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      return accumulatedText;
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      unsubscribe();
    }
  }

  cleanupIdleSubagents(): void {
    const maxReusable = this.dependencies.getMaxConcurrentSubagents?.() ?? 3;
    for (const [agentId, job] of this.backgroundJobs.entries()) {
      if (job.status === 'error') {
        job.agent.abort();
        this.backgroundJobs.delete(agentId);
      }
    }

    const reusable = [...this.backgroundJobs.values()]
      .filter((job) => job.status === 'completed')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    for (const stale of reusable.slice(maxReusable)) {
      stale.agent.abort();
      this.backgroundJobs.delete(stale.agentId);
    }
  }

  async spawn(config: AuxQueryConfig & { toolCallId: string; purpose: string }, prompt: string): Promise<{ agentId: string }> {
    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }
    if (/^\/compact(?:\s|$)/i.test(prompt.trim())) {
      throw new Error('Subagents cannot run context compaction. Start a fresh subagent with the actual task instead.');
    }
    const purposeKey = this.normalizePurposeKey(config.purpose || config.systemPrompt);
    const runningForPurpose = [...this.backgroundJobs.values()]
      .find((job) => job.purposeKey === purposeKey && job.status === 'running');
    if (runningForPurpose) {
      throw new Error(`A subagent for this purpose is already running (${runningForPurpose.agentId}).`);
    }

    const maxConcurrent = this.dependencies.getMaxConcurrentSubagents?.() ?? 3;
    const runningCount = [...this.backgroundJobs.values()]
      .filter((job) => job.status === 'running').length;
    if (runningCount >= maxConcurrent) {
      throw new Error(`Maximum concurrent subagents reached (${maxConcurrent}).`);
    }

    const job = await this.prepareReusableJob(config, purposeKey, prompt);
    this.startBackgroundPrompt(job, prompt);
    return { agentId: job.agentId };
  }

  private async prepareReusableJob(
    config: AuxQueryConfig & { toolCallId: string },
    purposeKey: string,
    prompt: string,
  ): Promise<BackgroundSubagentJob> {
    const reusable = [...this.backgroundJobs.values()]
      .filter((job) => job.purposeKey === purposeKey && job.status === 'completed')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    if (reusable) {
      if (!this.canReuseSubagent(reusable, config, prompt)) {
        reusable.agent.abort();
        reusable.agent.reset();
        this.backgroundJobs.delete(reusable.agentId);
      } else {
        reusable.toolCallId = config.toolCallId;
        reusable.toolCalls = [];
        reusable.finalResult = null;
        reusable.error = null;
        reusable.status = 'running';
        Object.assign(reusable, createBackgroundCompletion());
        reusable.lastUsedAt = Date.now();
        return reusable;
      }
    }

    const agent = await this.createAgent(config);
    const completion = createBackgroundCompletion();
    const job: BackgroundSubagentJob = {
      agentId: `subagent-${Date.now()}-${nextSubagentId++}`,
      purposeKey,
      toolCallId: config.toolCallId,
      agent,
      toolCalls: [],
      finalResult: null,
      error: null,
      status: 'running',
      ...completion,
      lastUsedAt: Date.now(),
    };
    this.backgroundJobs.set(job.agentId, job);
    return job;
  }

  private startBackgroundPrompt(job: BackgroundSubagentJob, prompt: string): void {
    const unsubscribe = job.agent.subscribe((event) => {
      for (const chunk of this.eventAdapter.adapt(event)) {
        this.recordBackgroundChunk(job, chunk);
      }
    });

    void job.agent.prompt(prompt)
      .then(() => {
        job.status = 'completed';
        job.lastUsedAt = Date.now();
        job.finalResult = this.extractFinalAssistantText(job.agent.state.messages);
        const result = job.finalResult || 'Background task completed.';
        job.resolveCompletion({ status: 'completed', result });
        this.dependencies.onSubagentChunk?.({
          type: 'async_subagent_result',
          agentId: job.agentId,
          status: 'completed',
          result,
        });
      })
      .catch((error: unknown) => {
        job.status = 'error';
        job.lastUsedAt = Date.now();
        job.error = error instanceof Error ? error.message : String(error);
        job.finalResult = job.error;
        job.resolveCompletion({ status: 'error', result: job.error });
        this.dependencies.onSubagentChunk?.({
          type: 'async_subagent_result',
          agentId: job.agentId,
          status: 'error',
          result: job.error,
        });
      })
      .finally(() => {
        unsubscribe();
      });
  }

  loadSubagentToolCalls(agentId: string): ToolCallInfo[] {
    return this.backgroundJobs.get(agentId)?.toolCalls.map((toolCall) => ({
      ...toolCall,
      input: { ...toolCall.input },
    })) ?? [];
  }

  loadSubagentFinalResult(agentId: string): string | null {
    return this.backgroundJobs.get(agentId)?.finalResult ?? null;
  }

  waitForResult(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }> {
    const job = this.backgroundJobs.get(agentId);
    if (!job) {
      return Promise.resolve({ status: 'error', result: `Subagent not found: ${agentId}` });
    }
    if (job.status !== 'running') {
      return Promise.resolve({
        status: job.status,
        result: job.finalResult || job.error || (job.status === 'error' ? 'Background task failed.' : 'Background task completed.'),
      });
    }
    return job.completion;
  }

  private async ensureAgent(config: AuxQueryConfig): Promise<Agent> {
    const nextKey = `${config.systemPrompt}::${config.model ?? ''}`;
    if (this.agent && this.configKey === nextKey) {
      return this.agent;
    }

    this.reset();

    this.agent = await this.createAgent(config);
    this.configKey = nextKey;
    return this.agent;
  }

  private async createAgent(config: AuxQueryConfig): Promise<Agent> {
    const model = this.dependencies.resolveModel(config.model);
    if (!model) {
      throw new Error('Could not resolve Pi model for auxiliary query.');
    }

    const auth = await this.dependencies.resolveAuth(model);
    if (!auth) {
      throw new Error(`Credentials not found for provider: ${model.provider}`);
    }

    return new Agent({
      initialState: {
        model,
        systemPrompt: config.systemPrompt,
        tools: this.dependencies.getTools?.() ?? [],
        messages: [],
        thinkingLevel: 'low',
      },
      convertToLlm: (messages) => messages as never[],
      streamFn: this.dependencies.streamSimple,
    });
  }

  private recordBackgroundChunk(job: BackgroundSubagentJob, chunk: StreamChunk): void {
    if (chunk.type === 'text') {
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_text', subagentId: job.toolCallId });
      return;
    }

    if (chunk.type === 'tool_use') {
      const toolCall: ToolCallInfo = {
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
        status: 'running',
        isExpanded: false,
      };
      job.toolCalls.push(toolCall);
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_tool_use', subagentId: job.toolCallId });
      return;
    }

    if (chunk.type === 'tool_result') {
      const toolCall = job.toolCalls.find((candidate) => candidate.id === chunk.id);
      if (toolCall) {
        toolCall.status = chunk.isError ? 'error' : 'completed';
        toolCall.result = chunk.content;
        if (chunk.toolUseResult) {
          toolCall.toolUseResult = chunk.toolUseResult;
        }
      }
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_tool_result', subagentId: job.toolCallId });
    }
  }

  private extractFinalAssistantText(messages: AgentMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index] as unknown as Record<string, unknown>;
      if (message.role !== 'assistant') {
        continue;
      }
      const content = message.content;
      if (typeof content === 'string') {
        return content;
      }
      if (!Array.isArray(content)) {
        continue;
      }
      const text = content.map((part) => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
      }).filter(Boolean).join('\n').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  private normalizePurposeKey(purpose: string): string {
    return purpose.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  }

  private canReuseSubagent(job: BackgroundSubagentJob, config: AuxQueryConfig, prompt: string): boolean {
    if (this.hasCompactionMarker(job.agent.state.messages)) {
      return false;
    }
    const model = this.dependencies.resolveModel(config.model);
    const modelContextWindow = (model as { contextWindow?: unknown } | null)?.contextWindow;
    const contextWindow = typeof modelContextWindow === 'number'
      ? modelContextWindow
      : DEFAULT_SUBAGENT_CONTEXT_WINDOW;
    const thresholdRatio = Math.min(0.95, Math.max(0.5, this.readAutoCompactThresholdRatio()));
    const projectedTokens = estimateAgentMessagesTokens(job.agent.state.messages)
      + estimateTextTokens(config.systemPrompt)
      + estimateTextTokens(prompt);
    return projectedTokens < Math.floor(contextWindow * thresholdRatio);
  }

  private hasCompactionMarker(messages: AgentMessage[]): boolean {
    return messages.some((message) => {
      const record = message as unknown as Record<string, unknown>;
      if (record.role === 'compactionSummary') {
        return true;
      }
      return textFromAgentMessage(message).includes('<context_compaction_summary>');
    });
  }

  private readAutoCompactThresholdRatio(): number {
    const settings = this.dependencies.getSettings?.();
    return typeof settings?.autoCompactThresholdRatio === 'number'
      ? settings.autoCompactThresholdRatio
      : 0.9;
  }
}

export function createPiAuxQueryRunner(
  plugin: PiRuntimeHost,
  onSubagentChunk?: (chunk: StreamChunk) => void,
  getTools?: () => AgentTool[],
): PiAuxQueryRunner {
  return new PiAuxQueryRunner({
    resolveModel: (modelKey) => resolvePiModel(plugin, modelKey),
    resolveAuth: (model) => resolvePiProviderAuth(plugin, model),
    streamSimple: piAiModels.streamSimple.bind(piAiModels),
    onSubagentChunk,
    getMaxConcurrentSubagents: () => getSubagentRuntimeSettingsFromBag(plugin.settings).maxConcurrentSubagents,
    getTools,
    getSettings: () => plugin.settings,
  });
}
