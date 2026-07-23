import {
  NetworkUrlError,
  normalizeHttpUrl,
  redactUrl,
  resolveRedirectUrl,
  isSchemeDowngrade,
} from '@pivi/pivi-agent-core/network';

describe('urlPolicy', () => {
  it('normalizes http(s) URLs and rejects credentials and other schemes', () => {
    expect(normalizeHttpUrl('https://Example.COM/path').href).toBe('https://example.com/path');
    expect(() => normalizeHttpUrl('ftp://example.com')).toThrow(NetworkUrlError);
    expect(() => normalizeHttpUrl('https://user:pass@example.com/')).toThrow(/credentials/i);
  });

  it('redacts credentials and sensitive query values without destroying origin/path', () => {
    expect(redactUrl('https://user:secret@example.com/a?token=abc&q=ok')).toBe(
      'https://***:***@example.com/a?token=***&q=ok',
    );
    expect(redactUrl('https://example.com/path?api_key=1&signature=2&safe=yes')).toContain('api_key=***');
    expect(redactUrl('https://example.com/path?api_key=1&signature=2&safe=yes')).toContain('signature=***');
    expect(redactUrl('https://example.com/path?api_key=1&signature=2&safe=yes')).toContain('safe=yes');
  });

  it('resolves redirects and detects scheme downgrades', () => {
    const current = new URL('https://example.com/a');
    expect(resolveRedirectUrl(current, '/b').href).toBe('https://example.com/b');
    expect(isSchemeDowngrade(current, new URL('http://example.com/b'))).toBe(true);
  });
});
