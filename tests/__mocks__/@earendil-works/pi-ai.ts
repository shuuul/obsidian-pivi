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
