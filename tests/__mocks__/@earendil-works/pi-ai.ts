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

const MOCK_PROVIDER_IDS = [
  'anthropic',
  'deepseek',
  'google',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'zai',
  'zai-coding-cn',
];

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

function credentialToMockAuth(credential: any): any {
  if (!credential) {
    return undefined;
  }
  if (credential.type === 'api_key' && credential.key) {
    return { auth: { apiKey: credential.key }, source: 'stored credential' };
  }
  if (credential.type === 'oauth' && credential.access) {
    return { auth: { apiKey: credential.access }, source: 'OAuth' };
  }
  return undefined;
}

function getMockProviderEnvVar(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    google: 'GEMINI_API_KEY',
    'kimi-coding': 'KIMI_API_KEY',
    moonshotai: 'MOONSHOT_API_KEY',
    'moonshotai-cn': 'MOONSHOT_API_KEY',
    'openai-codex': 'OPENAI_CODEX_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    'opencode-go': 'OPENCODE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return map[provider] ?? `${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`;
}

export function createModels(options?: any): any {
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
    getAuth: async (model: any) => {
      const stored = credentialToMockAuth(await options?.credentials?.read?.(model.provider));
      if (stored) {
        return stored;
      }
      const envVar = getMockProviderEnvVar(model.provider);
      const value = await options?.authContext?.env?.(envVar) ?? process.env[envVar];
      return value ? { auth: { apiKey: value }, source: envVar } : undefined;
    },
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
export const kimiCodingProvider = () => mockProvider('kimi-coding');
export const minimaxProvider = () => mockProvider('minimax');
export const minimaxCnProvider = () => mockProvider('minimax-cn');
export const moonshotaiProvider = () => mockProvider('moonshotai');
export const moonshotaiCnProvider = () => mockProvider('moonshotai-cn');
export const openaiProvider = () => mockProvider('openai');
export const openaiCodexProvider = () => mockProvider('openai-codex');
export const opencodeProvider = () => mockProvider('opencode');
export const opencodeGoProvider = () => mockProvider('opencode-go');
export const openrouterProvider = () => mockProvider('openrouter');
export const xiaomiProvider = () => mockProvider('xiaomi');
export const xiaomiTokenPlanCnProvider = () => mockProvider('xiaomi-token-plan-cn');
export const zaiProvider = () => mockProvider('zai');
export const zaiCodingCnProvider = () => mockProvider('zai-coding-cn');

export function builtinModels(): any {
  return {
    getProviders: () => getProviders().map((id) => ({ id, name: id })),
    getModels,
    getModel,
    streamSimple,
  };
}

const EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

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
    if (level === 'xhigh' || level === 'max') {
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
