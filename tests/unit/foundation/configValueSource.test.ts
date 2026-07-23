/**
 * Unit tests for config value sources and secret-like classification.
 */

import {
  assertAllowedSourceForKey,
  defaultSourceKindForKey,
  isSecretLikeHeaderName,
  isSecretLikeKey,
  normalizeConfigValueRef,
  resolveConfigValue,
} from '@pivi/pivi-agent-core/foundation/configValueSource';

describe('configValueSource', () => {
  it('classifies secret-like keys', () => {
    expect(isSecretLikeKey('OPENAI_API_KEY')).toBe(true);
    expect(isSecretLikeKey('MY_TOKEN')).toBe(true);
    expect(isSecretLikeKey('DB_SECRET')).toBe(true);
    expect(isSecretLikeKey('DB_PASSWORD')).toBe(true);
    expect(isSecretLikeKey('AUTHORIZATION')).toBe(true);
    expect(isSecretLikeKey('COOKIE')).toBe(true);
    expect(isSecretLikeKey('PATH')).toBe(false);
    expect(isSecretLikeKey('HTTP_PROXY')).toBe(false);
  });

  it('classifies secret-like headers', () => {
    expect(isSecretLikeHeaderName('Authorization')).toBe(true);
    expect(isSecretLikeHeaderName('Proxy-Authorization')).toBe(true);
    expect(isSecretLikeHeaderName('Cookie')).toBe(true);
    expect(isSecretLikeHeaderName('X-Api-Key')).toBe(true);
    expect(isSecretLikeHeaderName('Accept')).toBe(false);
  });

  it('defaults secret-like imports to secret source', () => {
    expect(defaultSourceKindForKey('FOO_API_KEY')).toBe('secret');
    expect(defaultSourceKindForKey('PATH')).toBe('plain');
  });

  it('blocks unresolved secret-like plaintext', () => {
    expect(() => assertAllowedSourceForKey('FOO_TOKEN', { kind: 'plain', value: 'x' }))
      .toThrow(/cannot be saved as plaintext/);
    expect(() => assertAllowedSourceForKey('FOO_TOKEN', { kind: 'secret', value: 'x' }))
      .not.toThrow();
    expect(() => assertAllowedSourceForKey('FOO_TOKEN', { kind: 'systemEnvironment' }))
      .not.toThrow();
  });

  it('normalizes legacy plaintext strings to plain refs', () => {
    expect(normalizeConfigValueRef('hello')).toEqual({ kind: 'plain', value: 'hello' });
    expect(normalizeConfigValueRef({ kind: 'secret' })).toEqual({ kind: 'secret' });
    expect(normalizeConfigValueRef({ kind: 'systemEnvironment', name: 'HOME' }))
      .toEqual({ kind: 'systemEnvironment', name: 'HOME' });
  });

  it('resolves systemEnvironment without copying into stores', () => {
    const seenSecrets: string[] = [];
    const value = resolveConfigValue(
      { kind: 'systemEnvironment' },
      'unused-secret',
      {
        getSecret(id) {
          seenSecrets.push(id);
          return null;
        },
        getSystemEnvironmentVariable(name) {
          return name === 'HOME' ? '/tmp/home' : undefined;
        },
      },
      'HOME',
    );
    expect(value).toBe('/tmp/home');
    expect(seenSecrets).toEqual([]);
  });
});
