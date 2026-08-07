import {
  createPiviOpenRouterOAuth,
  parseOpenRouterAuthorizationInput,
  resolveOpenRouterOAuthCallbackHost,
} from '@pivi/pivi-agent-core/engine/pi/piviOpenRouterOAuth';

describe('piviOpenRouterOAuth', () => {
  const originalHost = process.env.PI_OAUTH_CALLBACK_HOST;

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env.PI_OAUTH_CALLBACK_HOST;
    } else {
      process.env.PI_OAUTH_CALLBACK_HOST = originalHost;
    }
  });

  it('defaults the callback host to 127.0.0.1 like upstream pi', () => {
    delete process.env.PI_OAUTH_CALLBACK_HOST;
    expect(resolveOpenRouterOAuthCallbackHost()).toBe('127.0.0.1');
  });

  it('honors PI_OAUTH_CALLBACK_HOST when set', () => {
    process.env.PI_OAUTH_CALLBACK_HOST = '127.0.0.1';
    expect(resolveOpenRouterOAuthCallbackHost()).toBe('127.0.0.1');
  });

  it('accepts a redirect URL, query string, or bare manual authorization code', () => {
    expect(parseOpenRouterAuthorizationInput('https://localhost/callback?code=url-code')).toBe('url-code');
    expect(parseOpenRouterAuthorizationInput('state=x&code=query-code')).toBe('query-code');
    expect(parseOpenRouterAuthorizationInput('bare-code')).toBe('bare-code');
    expect(parseOpenRouterAuthorizationInput('   ')).toBeUndefined();
  });

  it('exposes the OpenRouter OAuth metadata through the Pivi shim', () => {
    const oauth = createPiviOpenRouterOAuth(async () => new Response('{}', { status: 500 }));
    expect(oauth.name).toBe('OpenRouter OAuth');
    expect(oauth.loginLabel).toBe('Sign in with OpenRouter');
    expect(typeof oauth.login).toBe('function');
    expect(typeof oauth.refresh).toBe('function');
    expect(typeof oauth.toAuth).toBe('function');
  });

  it('exchanges a manually pasted redirect URL through the injected provider fetch', async () => {
    const request = jest.fn().mockResolvedValue(new Response(JSON.stringify({ key: 'oauth-key' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const oauth = createPiviOpenRouterOAuth(request);
    const prompt = jest.fn().mockResolvedValue('https://remote.test/callback?code=manual-code');

    await expect(oauth.login({
      signal: new AbortController().signal,
      notify: jest.fn(),
      prompt,
    })).resolves.toMatchObject({
      type: 'oauth',
      access: 'oauth-key',
    });

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ type: 'manual_code' }));
    expect(request).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/auth/keys',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('manual-code'),
      }),
    );
  });
});
