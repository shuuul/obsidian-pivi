import {
  assertValidMcpServerName,
  createMcpServerMap,
  isValidMcpServerName,
  McpValidationError,
  setMcpServerMapEntry,
  validateMcpRemoteUrl,
} from '@pivi/pivi-agent-core/mcp/mcpValidation';

describe('mcpValidation', () => {
  it('rejects reserved server names', () => {
    for (const name of ['__proto__', 'prototype', 'constructor']) {
      expect(isValidMcpServerName(name)).toBe(false);
      expect(() => assertValidMcpServerName(name)).toThrow(McpValidationError);
    }
  });

  it('accepts only http and https remote URLs', () => {
    expect(() => validateMcpRemoteUrl('file:///tmp/mcp')).toThrow(McpValidationError);
    expect(() => validateMcpRemoteUrl('javascript:alert(1)')).toThrow(McpValidationError);
    expect(validateMcpRemoteUrl('https://example.test/mcp')).toContain('https://example.test/mcp');
  });

  it('allows plain HTTP only for loopback hosts', () => {
    expect(validateMcpRemoteUrl('http://127.0.0.1:3000/sse')).toContain('127.0.0.1');
    expect(validateMcpRemoteUrl('http://localhost:3000/sse')).toContain('localhost');
    expect(() => validateMcpRemoteUrl('http://example.test/mcp')).toThrow('loopback');
  });

  it('stores entries on null-prototype maps without polluting Object.prototype', () => {
    const map = createMcpServerMap<string>();
    setMcpServerMapEntry(map, 'safe', 'value');
    expect(Object.prototype).not.toHaveProperty('safe');
    expect(map.safe).toBe('value');
    expect(() => setMcpServerMapEntry(map, '__proto__', 'polluted')).toThrow(McpValidationError);
  });
});
