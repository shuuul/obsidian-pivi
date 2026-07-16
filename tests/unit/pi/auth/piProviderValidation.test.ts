import { getProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import {
  isBuiltinPiProviderId,
  isKnownPiProviderId,
  isSupportedPiModelKey,
  isSupportedPiProviderId,
  SUPPORTED_PI_PROVIDER_IDS,
} from '@pivi/pivi-agent-core/auth/piProviderValidation';

describe('pi provider validation', () => {
  it('recognizes the supported provider ids used by pi runtime defaults', () => {
    expect([...SUPPORTED_PI_PROVIDER_IDS]).toEqual([
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
      'xai',
      'xiaomi',
      'xiaomi-token-plan-cn',
      'zai',
      'zai-coding-cn',
    ]);
    expect(isSupportedPiProviderId('anthropic')).toBe(true);
    expect(isBuiltinPiProviderId('anthropic')).toBe(true);
    expect(isSupportedPiProviderId('moonshotai')).toBe(true);
    expect(isSupportedPiProviderId('xiaomi-token-plan-cn')).toBe(true);
    expect(isSupportedPiProviderId('openrouter')).toBe(true);
    expect(isSupportedPiProviderId('not-a-provider')).toBe(false);
    expect(isSupportedPiProviderId('ollama')).toBe(false);
  });

  it('accepts model keys only when the provider prefix is supported', () => {
    expect(isSupportedPiModelKey('anthropic/claude-3')).toBe(true);
    expect(isSupportedPiModelKey('openai/gpt-4.1')).toBe(true);
    expect(isSupportedPiModelKey('zai-coding-cn/glm-4.7')).toBe(true);
    expect(isSupportedPiModelKey('openrouter/openai/gpt-4.1')).toBe(true);
    expect(isSupportedPiModelKey('not-a-provider/model')).toBe(false);
    expect(isSupportedPiModelKey('no-slash')).toBe(false);
    expect(isSupportedPiModelKey('/missing-provider')).toBe(false);
    expect(isSupportedPiModelKey('ollama/llama3', ['ollama'])).toBe(true);
    expect(isKnownPiProviderId('ollama', ['ollama'])).toBe(true);
    expect(isKnownPiProviderId('ollama')).toBe(false);
  });

  it('uses pi-ai credential environment variable names for added providers', () => {
    expect(getProviderEnvVarNames('kimi-coding').apiKeyVar).toBe('KIMI_API_KEY');
    expect(getProviderEnvVarNames('moonshotai').apiKeyVar).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVarNames('moonshotai-cn').apiKeyVar).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVarNames('xiaomi-token-plan-cn').apiKeyVar).toBe(
      'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    );
    expect(getProviderEnvVarNames('zai-coding-cn').apiKeyVar).toBe('ZAI_CODING_CN_API_KEY');
  });
});
