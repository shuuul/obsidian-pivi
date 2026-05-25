import { Agent } from '@earendil-works/pi-agent-core';
import * as piAi from '@earendil-works/pi-ai';

import type { AuxQueryConfig, AuxQueryRunner } from '../../core/auxiliary/AuxQueryRunner';
import type ObsiusPlugin from '../../main';
import { PiAgentEventAdapter } from './PiAgentEventAdapter';
import { resolvePiApiKey, resolvePiModel } from './piModelEnv';

export class PiAuxQueryRunner implements AuxQueryRunner {
  private agent: Agent | null = null;
  private configKey: string | null = null;
  private readonly eventAdapter = new PiAgentEventAdapter();

  constructor(private readonly plugin: ObsiusPlugin) {}

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

    const agent = this.ensureAgent(config);
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

  private ensureAgent(config: AuxQueryConfig): Agent {
    const nextKey = `${config.systemPrompt}::${config.model ?? ''}`;
    if (this.agent && this.configKey === nextKey) {
      return this.agent;
    }

    this.reset();

    const model = resolvePiModel(this.plugin, config.model);
    if (!model) {
      throw new Error('Could not resolve Pi model for auxiliary query.');
    }

    const provider = model.provider;
    const apiKey = resolvePiApiKey(this.plugin, provider);
    if (!apiKey) {
      throw new Error(`API key not found for provider: ${provider}`);
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
      streamFn: piAi.streamSimple,
      getApiKey: (requestedProvider: string) => resolvePiApiKey(this.plugin, requestedProvider),
    });
    this.configKey = nextKey;
    return this.agent;
  }
}
