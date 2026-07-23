import {
  assertDestinationAllowed,
  assertPinnedAddress,
  EgressDeniedError,
  EgressPolicyError,
  filterRedirectHeaders,
  grantPrivateOrigins,
  OriginGrantRegistry,
  prepareRedirect,
  resolveEgressPolicy,
} from '@pivi/pivi-agent-core/network';

describe('egressPolicy', () => {
  const policy = resolveEgressPolicy({ purpose: 'web-fetch' });

  it('denies public-looking hosts that resolve to private addresses', () => {
    expect(() => assertDestinationAllowed(
      new URL('https://evil.example/'),
      ['10.0.0.5'],
      policy,
    )).toThrow(EgressDeniedError);
  });

  it('allows short-lived origin grants without a permanent private bypass', () => {
    const grants = new OriginGrantRegistry();
    const url = new URL('http://127.0.0.1:11434/');
    expect(() => assertDestinationAllowed(url, ['127.0.0.1'], policy, grants)).toThrow(EgressDeniedError);
    grants.grant(url, 60_000, 'provider');
    expect(() => assertDestinationAllowed(url, ['127.0.0.1'], {
      ...policy,
      purpose: 'provider',
    }, grants)).not.toThrow();
  });

  it('grantPrivateOrigins grants only private origins and revokeByPurpose is scoped', () => {
    const grants = new OriginGrantRegistry();
    grantPrivateOrigins(
      grants,
      ['http://127.0.0.1:11434', 'https://api.example.com', 'http://localhost:3000', 'not-a-url'],
      'provider',
    );
    const providerPolicy = { ...policy, purpose: 'provider' as const };

    // Private/loopback configured origins are granted for the provider purpose.
    expect(() => assertDestinationAllowed(
      new URL('http://127.0.0.1:11434/'), ['127.0.0.1'], providerPolicy, grants,
    )).not.toThrow();
    expect(() => assertDestinationAllowed(
      new URL('http://localhost:3000/'), ['127.0.0.1'], providerPolicy, grants,
    )).not.toThrow();

    // Public-looking domains are NOT pre-granted; a private resolution is denied.
    expect(() => assertDestinationAllowed(
      new URL('https://api.example.com/'), ['10.0.0.1'], providerPolicy, grants,
    )).toThrow(EgressDeniedError);

    // The grant is purpose-scoped: MCP egress to the same origin is still denied.
    expect(() => assertDestinationAllowed(
      new URL('http://127.0.0.1:11434/'), ['127.0.0.1'], { ...policy, purpose: 'mcp' }, grants,
    )).toThrow(EgressDeniedError);

    // Revoking the provider purpose removes its grants without affecting others.
    grants.grant(new URL('http://192.168.0.5/'), 60_000, 'mcp');
    grants.revokeByPurpose('provider');
    expect(() => assertDestinationAllowed(
      new URL('http://127.0.0.1:11434/'), ['127.0.0.1'], providerPolicy, grants,
    )).toThrow(EgressDeniedError);
    expect(() => assertDestinationAllowed(
      new URL('http://192.168.0.5/'), ['192.168.0.5'], { ...policy, purpose: 'mcp' }, grants,
    )).not.toThrow();
  });

  it('pins connected addresses against the approved resolution set', () => {
    const url = new URL('https://example.com/');
    expect(() => assertPinnedAddress(['1.2.3.4'], '1.2.3.4', url)).not.toThrow();
    expect(() => assertPinnedAddress(['1.2.3.4'], '10.0.0.1', url)).toThrow(EgressPolicyError);
  });

  it('bounds redirects, denies scheme downgrade, and strips sensitive cross-origin headers', () => {
    const from = new URL('https://a.example/x');
    expect(() => prepareRedirect(from, 'http://b.example/y', 0, policy)).toThrow(/HTTPS to HTTP/i);
    expect(() => prepareRedirect(from, 'https://b.example/y', 5, policy)).toThrow(/maximum redirects/i);

    const headers = new Headers({
      authorization: 'Bearer secret',
      'x-api-key': 'k',
      accept: 'application/json',
    });
    const filtered = filterRedirectHeaders(headers, from, new URL('https://b.example/y'));
    expect(filtered.get('authorization')).toBeNull();
    expect(filtered.get('x-api-key')).toBeNull();
    expect(filtered.get('accept')).toBe('application/json');
  });
});
