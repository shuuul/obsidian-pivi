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

const MOCK_PROVIDER_IDS = ['anthropic', 'deepseek', 'google', 'openai-codex', 'opencode-go', 'openrouter'];

export function getProviders(): string[] {
  return MOCK_PROVIDER_IDS;
}

export function getModels(provider: string): any[] {
  return [getModel(provider, 'mock-model')];
}

const mockAssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'anthropic-messages',
  provider: 'mock-provider',
  model: 'mock-model',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 0,
};

export function createMockStream(message: any = mockAssistantMessage): any {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
    result: () => Promise.resolve(message),
  };
}

export function streamSimple(): any {
  return createMockStream();
}

export function registerBuiltInApiProviders(): void {}

export function createModels(): any {
  const providers = new Map<string, any>();
  return {
    setProvider: (provider: any) => providers.set(provider.id, provider),
    getProviders: () => [...providers.values()],
    getProvider: (id: string) => providers.get(id),
    getModels: (provider?: string) => {
      if (provider) {
        return providers.get(provider)?.getModels?.() ?? getModels(provider);
      }
      return [...providers.keys()].flatMap((id) => getModels(id));
    },
    getModel: (provider: string, modelId: string) => getModel(provider, modelId),
    getAuth: () => Promise.resolve(undefined),
    stream: streamSimple,
    streamSimple,
    complete: () => Promise.resolve(mockAssistantMessage),
    completeSimple: () => Promise.resolve(mockAssistantMessage),
  };
}

function mockProvider(id: string): any {
  return {
    id,
    name: id,
    auth: {
      oauth: id === 'openai-codex'
        ? {
            login: () => Promise.resolve({
              type: 'oauth',
              access: 'mock-access',
              refresh: 'mock-refresh',
              expires: Date.now() + 3600_000,
            }),
          }
        : undefined,
    },
    getModels: () => getModels(id),
  };
}

export const anthropicProvider = () => mockProvider('anthropic');
export const deepseekProvider = () => mockProvider('deepseek');
export const googleProvider = () => mockProvider('google');
export const openaiCodexProvider = () => mockProvider('openai-codex');
export const opencodeGoProvider = () => mockProvider('opencode-go');
export const openrouterProvider = () => mockProvider('openrouter');

export function builtinModels(): any {
  return {
    getProviders: () => getProviders().map((id) => ({ id, name: id })),
    getModels,
    getModel,
    streamSimple,
  };
}

const EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export function getSupportedThinkingLevels(model: {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, unknown>;
}): Array<(typeof EXTENDED_THINKING_LEVELS)[number]> {
  if (!model.reasoning) {
    return ['off'];
  }
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) {
      return false;
    }
    if (level === 'xhigh') {
      return mapped !== undefined;
    }
    return true;
  });
}

export function clampThinkingLevel(
  model: { reasoning?: boolean; thinkingLevelMap?: Record<string, unknown> },
  level: (typeof EXTENDED_THINKING_LEVELS)[number],
): (typeof EXTENDED_THINKING_LEVELS)[number] {
  const availableLevels = getSupportedThinkingLevels(model);
  if (availableLevels.includes(level)) {
    return level;
  }
  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  if (requestedIndex === -1) {
    return availableLevels[0] ?? 'off';
  }
  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (availableLevels.includes(candidate)) {
      return candidate;
    }
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (availableLevels.includes(candidate)) {
      return candidate;
    }
  }
  return availableLevels[0] ?? 'off';
}
