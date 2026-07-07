import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, AuthResult, Model } from '@earendil-works/pi-ai';
import type { StreamChunk, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { getSubagentRuntimeSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';

import type { AuxQueryConfig, AuxQueryRunner } from '../../runtime/auxQueryRunner';
import { PiAgentEventAdapter } from './piAgentEventAdapter';
import { piAiModels } from './piAiModels';
import { PiBackgroundSubagentJobs } from './piBackgroundSubagentJobs';
import { resolvePiModel, resolvePiProviderAuth } from './piModelEnv';
import type { PiRuntimeHost } from './piRuntimeHost';

type PiAgentOptions = NonNullable<ConstructorParameters<typeof Agent>[0]>;
type PiAuxQueryModel = Model<Api>;
type PiAuxQueryStreamFn = PiAgentOptions['streamFn'];

export interface PiAuxQueryRunnerDependencies<TModel extends PiAuxQueryModel = PiAuxQueryModel> {
  resolveModel(modelKey?: string): TModel | null;
  resolveAuth(model: TModel): Promise<AuthResult | undefined>;
  streamSimple: PiAuxQueryStreamFn;
  onSubagentChunk?: (chunk: StreamChunk) => void;
  getMaxConcurrentSubagents?: () => number;
  getTools?: () => AgentTool[];
}

export class PiAuxQueryRunner<TModel extends PiAuxQueryModel = PiAuxQueryModel> implements AuxQueryRunner {
  private agent: Agent | null = null;
  private configKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter();
  private readonly backgroundJobs: PiBackgroundSubagentJobs;

  constructor(private readonly dependencies: PiAuxQueryRunnerDependencies<TModel>) {
    this.backgroundJobs = new PiBackgroundSubagentJobs({
      createAgent: (config) => this.createAgent(config),
      onSubagentChunk: dependencies.onSubagentChunk,
      getMaxConcurrentSubagents: dependencies.getMaxConcurrentSubagents,
    });
  }

  reset(): void {
    this.agent?.abort();
    this.agent?.reset();
    this.agent = null;
    this.configKey = null;
  }

  abortAllSubagents(): void {
    this.backgroundJobs.abortAll();
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
    this.backgroundJobs.cleanupIdle();
  }

  async spawn(config: AuxQueryConfig & { toolCallId: string; purpose: string }, prompt: string): Promise<{ agentId: string }> {
    return this.backgroundJobs.spawn(config, prompt);
  }

  loadSubagentToolCalls(agentId: string): ToolCallInfo[] {
    return this.backgroundJobs.loadToolCalls(agentId);
  }

  loadSubagentFinalResult(agentId: string): string | null {
    return this.backgroundJobs.loadFinalResult(agentId);
  }

  waitForResult(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }> {
    return this.backgroundJobs.waitForResult(agentId);
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
  });
}
