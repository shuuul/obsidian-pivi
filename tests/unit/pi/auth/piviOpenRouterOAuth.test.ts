import {
  createPiviOpenRouterOAuth,
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

  it('exposes the OpenRouter OAuth metadata through the Pivi shim', () => {
    const oauth = createPiviOpenRouterOAuth(async () => new Response('{}', { status: 500 }));
    expect(oauth.name).toBe('OpenRouter OAuth');
    expect(oauth.loginLabel).toBe('Sign in with OpenRouter');
    expect(typeof oauth.login).toBe('function');
    expect(typeof oauth.refresh).toBe('function');
    expect(typeof oauth.toAuth).toBe('function');
  });
});
