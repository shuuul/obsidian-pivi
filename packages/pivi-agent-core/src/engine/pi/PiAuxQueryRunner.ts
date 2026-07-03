import { Agent } from '@earendil-works/pi-agent-core';

import type { AuxQueryConfig, AuxQueryRunner } from '../../runtime/AuxQueryRunner';
import { PiAgentEventAdapter } from './PiAgentEventAdapter';
import { piAiModels } from './PiAiModels';
import { resolvePiModel, resolvePiProviderAuth } from './PiModelEnv';
import type { PiRuntimeHost } from './PiRuntimeHost';

type PiAgentOptions = NonNullable<ConstructorParameters<typeof Agent>[0]>;
type PiAuxQueryModel = NonNullable<PiAgentOptions['initialState']>['model'] & { provider: string };
type PiAuxQueryStreamFn = PiAgentOptions['streamFn'];

export interface PiAuxQueryRunnerDependencies<TModel extends PiAuxQueryModel = PiAuxQueryModel> {
  resolveModel(modelKey?: string): TModel | null;
  resolveAuth(model: TModel): Promise<unknown | undefined>;
  streamSimple: PiAuxQueryStreamFn;
}

export class PiAuxQueryRunner<TModel extends PiAuxQueryModel = PiAuxQueryModel> implements AuxQueryRunner {
  private agent: Agent | null = null;
  private configKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter();

  constructor(private readonly dependencies: PiAuxQueryRunnerDependencies<TModel>) {}

  reset(): void {
    this.agent?.abort();
    this.agent?.reset();
    this.agent = null;
    this.configKey = null;
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

  private async ensureAgent(config: AuxQueryConfig): Promise<Agent> {
    const nextKey = `${config.systemPrompt}::${config.model ?? ''}`;
    if (this.agent && this.configKey === nextKey) {
      return this.agent;
    }

    this.reset();

    const model = this.dependencies.resolveModel(config.model);
    if (!model) {
      throw new Error('Could not resolve Pi model for auxiliary query.');
    }

    const auth = await this.dependencies.resolveAuth(model);
    if (!auth) {
      throw new Error(`Credentials not found for provider: ${model.provider}`);
    }

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt: config.systemPrompt,
        tools: [],
        messages: [],
        thinkingLevel: 'low',
      },
      convertToLlm: (messages) => messages as never[],
      streamFn: this.dependencies.streamSimple,
    });
    this.configKey = nextKey;
    return this.agent;
  }
}

export function createPiAuxQueryRunner(plugin: PiRuntimeHost): PiAuxQueryRunner {
  return new PiAuxQueryRunner({
    resolveModel: (modelKey) => resolvePiModel(plugin, modelKey),
    resolveAuth: (model) => resolvePiProviderAuth(plugin, model),
    streamSimple: piAiModels.streamSimple.bind(piAiModels),
  });
}
