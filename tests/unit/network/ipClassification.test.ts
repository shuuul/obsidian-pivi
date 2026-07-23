import {
  canonicalizeIpAddress,
  classifyIpLiteral,
  expandIpv4Literal,
  isDeniedIpClass,
} from '@pivi/pivi-agent-core/network';

describe('ipClassification', () => {
  it('classifies IPv4 loopback, private, link-local, multicast, unspecified, and metadata', () => {
    expect(classifyIpLiteral('127.0.0.1')).toBe('loopback');
    expect(classifyIpLiteral('10.0.0.1')).toBe('private');
    expect(classifyIpLiteral('172.16.5.1')).toBe('private');
    expect(classifyIpLiteral('192.168.1.1')).toBe('private');
    expect(classifyIpLiteral('169.254.1.1')).toBe('link-local');
    expect(classifyIpLiteral('169.254.169.254')).toBe('cloud-metadata');
    expect(classifyIpLiteral('100.100.100.200')).toBe('cloud-metadata');
    expect(classifyIpLiteral('224.0.0.1')).toBe('multicast');
    expect(classifyIpLiteral('0.0.0.0')).toBe('unspecified');
    expect(classifyIpLiteral('8.8.8.8')).toBe('public');
  });

  it('accepts alternate IPv4 representations', () => {
    expect(expandIpv4Literal('2130706433')).toEqual([127, 0, 0, 1]);
    expect(classifyIpLiteral('2130706433')).toBe('loopback');
    expect(classifyIpLiteral('0x7f000001')).toBe('loopback');
    expect(classifyIpLiteral('0177.0.0.1')).toBe('loopback');
    expect(classifyIpLiteral('127.1')).toBe('loopback');
    expect(classifyIpLiteral('127.0.1')).toBe('loopback');
  });

  it('classifies IPv6 loopback, ULA, link-local, multicast, and mapped forms', () => {
    expect(classifyIpLiteral('::1')).toBe('loopback');
    expect(classifyIpLiteral('::')).toBe('unspecified');
    expect(classifyIpLiteral('fc00::1')).toBe('private');
    expect(classifyIpLiteral('fd12:3456:789a::1')).toBe('private');
    expect(classifyIpLiteral('fe80::1')).toBe('link-local');
    expect(classifyIpLiteral('ff02::1')).toBe('multicast');
    expect(classifyIpLiteral('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyIpLiteral('::ffff:169.254.169.254')).toBe('cloud-metadata');
    expect(classifyIpLiteral('2001:4860:4860::8888')).toBe('public');
  });

  it('canonicalizes addresses for pin comparison', () => {
    expect(canonicalizeIpAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(canonicalizeIpAddress('::ffff:127.0.0.1')).toBe('0:0:0:0:0:ffff:7f00:1');
  });

  it('marks denied classes', () => {
    expect(isDeniedIpClass('public')).toBe(false);
    expect(isDeniedIpClass('loopback')).toBe(true);
    expect(isDeniedIpClass('cloud-metadata')).toBe(true);
  });
});
