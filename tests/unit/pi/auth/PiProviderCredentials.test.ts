import {
  parseProviderCredential,
  serializeProviderCredential,
  type ApiKeyProviderCredential,
  type OAuthProviderCredential,
} from '@pivi/pivi-agent-core/auth/PiProviderCredentials';

describe('parseProviderCredential', () => {
  it.each([
    { name: 'null', raw: null },
    { name: 'empty string', raw: '' },
    { name: 'whitespace only', raw: '   ' },
    { name: 'malformed JSON', raw: '{not json' },
    { name: 'JSON string primitive', raw: '"api-key"' },
    { name: 'JSON array', raw: '[]' },
    { name: 'JSON number', raw: '42' },
    { name: 'object without recognized type', raw: '{"key":"sk"}' },
    { name: 'unsupported credential type', raw: '{"type":"bearer","token":"x"}' },
  ])('returns undefined for $name', ({ raw }) => {
    expect(parseProviderCredential(raw)).toBeUndefined();
  });

  it('parses valid api-key JSON', () => {
    const raw = JSON.stringify({ type: 'api-key', key: 'sk-test-123' });
    expect(parseProviderCredential(raw)).toEqual({
      type: 'api-key',
      key: 'sk-test-123',
    } satisfies ApiKeyProviderCredential);
  });

  it('parses valid oauth JSON with refresh and expires', () => {
    const payload: OAuthProviderCredential = {
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: 1_700_000_000_000,
    };
    const raw = JSON.stringify(payload);
    expect(parseProviderCredential(raw)).toEqual(payload);
  });
});

describe('serializeProviderCredential', () => {
  it('serializes api-key credentials to JSON parseable by parseProviderCredential', () => {
    const credential: ApiKeyProviderCredential = { type: 'api-key', key: 'sk-serialize' };
    const raw = serializeProviderCredential(credential);
    expect(JSON.parse(raw)).toEqual(credential);
    expect(parseProviderCredential(raw)).toEqual(credential);
  });

  it('serializes oauth credentials with refresh and expires for round-trip', () => {
    const credential: OAuthProviderCredential = {
      type: 'oauth',
      access: 'at',
      refresh: 'rt',
      expires: 99,
    };
    const raw = serializeProviderCredential(credential);
    expect(parseProviderCredential(raw)).toEqual(credential);
  });
});