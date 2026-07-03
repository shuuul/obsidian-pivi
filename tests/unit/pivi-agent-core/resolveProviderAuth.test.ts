import { resolveProviderAuth } from '@pivi/pivi-agent-core/auth/resolveProviderAuth';
import type { ModelAuthHost, ProviderAuthModel } from '@pivi/pivi-agent-core/ports';

type TestAuth = { apiKey: string };

type TestModel = ProviderAuthModel & { modelId: string };

function createModel(provider: string, modelId = 'test-model'): TestModel {
  return { provider, modelId };
}

function createAuthHost(
  impl?: (model: TestModel) => Promise<TestAuth | undefined>,
): ModelAuthHost<TestModel, TestAuth> & { getAuth: jest.Mock } {
  const getAuth = jest.fn(impl ?? (async () => ({ apiKey: 'secret' })));
  return { getAuth };
}

describe('resolveProviderAuth', () => {
  it('delegates to ModelAuthHost.getAuth for enabled providers', async () => {
    const model = createModel('openai');
    const auth = { apiKey: 'sk-test' };
    const modelAuthHost = createAuthHost(async (m) => {
      expect(m).toBe(model);
      return auth;
    });

    await expect(
      resolveProviderAuth({ model, modelAuthHost }),
    ).resolves.toEqual(auth);
    expect(modelAuthHost.getAuth).toHaveBeenCalledTimes(1);
    expect(modelAuthHost.getAuth).toHaveBeenCalledWith(model);
  });

  it('returns undefined and does not call the host when the provider is disabled', async () => {
    const model = createModel('anthropic');
    const modelAuthHost = createAuthHost();

    await expect(
      resolveProviderAuth({
        model,
        modelAuthHost,
        disabledProviders: ['anthropic', 'other'],
      }),
    ).resolves.toBeUndefined();
    expect(modelAuthHost.getAuth).not.toHaveBeenCalled();
  });

  it('propagates undefined from the host when the provider is enabled', async () => {
    const model = createModel('google');
    const modelAuthHost = createAuthHost(async () => undefined);

    await expect(
      resolveProviderAuth({ model, modelAuthHost }),
    ).resolves.toBeUndefined();
    expect(modelAuthHost.getAuth).toHaveBeenCalledTimes(1);
  });
});