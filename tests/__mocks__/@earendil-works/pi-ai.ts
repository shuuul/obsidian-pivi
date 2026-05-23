export function getModel(provider: string, modelId: string): any {
  return {
    id: modelId,
    provider,
    api: 'anthropic-messages',
    name: `Mock ${provider}/${modelId}`,
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

export function getProviders(): string[] {
  return ['anthropic', 'openai', 'google'];
}

export function getModels(provider: string): any[] {
  return [getModel(provider, 'mock-model')];
}

export function streamSimple(): any {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
  };
}

export function registerBuiltInApiProviders(): void {}
